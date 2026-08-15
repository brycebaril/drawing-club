import { pool } from "@/lib/db/pool";
import { getSettingNumber } from "@/lib/settings";
import { combineDateAndTime, computeOccurrenceDates } from "./dates";

/**
 * No scheduler infra exists yet (EventBridge is still unprovisioned AWS
 * work — ArchitectureDocument.md §8) — sessions are generated up to this
 * fixed horizon instead, re-triggerable via `pnpm rollforward` or the
 * admin "Generate more sessions" action until a real scheduled job lands.
 */
export const ROLLFORWARD_HORIZON_DAYS = 90;

interface RuleRow {
  id: string;
  session_type: string;
  description: string | null;
  day_of_week: number;
  start_time_of_day: string;
  end_time_of_day: string;
  max_capacity: number | null;
  default_host_user_id: string | null;
  start_date: Date;
  end_date: Date | null;
}

/**
 * Generates any not-yet-created occurrences for `ruleId` up to the
 * rollforward horizon (or the rule's own end_date, if sooner). Always
 * resumes from the latest already-generated occurrence, so calling this
 * repeatedly is safe — it never regenerates or duplicates a date.
 */
export async function generateSessionsForRule(ruleId: string): Promise<number> {
  const ruleResult = await pool.query<RuleRow>(
    `SELECT id, session_type, description, day_of_week, start_time_of_day, end_time_of_day,
            max_capacity, default_host_user_id, start_date, end_date
     FROM recurrence_rules WHERE id = $1`,
    [ruleId],
  );
  if (ruleResult.rowCount === 0) return 0;
  const rule = ruleResult.rows[0];

  const latestResult = await pool.query<{ max: Date | null }>(
    `SELECT max(start_time) FROM sessions WHERE recurrence_rule_id = $1`,
    [ruleId],
  );
  const latestGenerated = latestResult.rows[0].max;

  const rangeStart = latestGenerated
    ? new Date(new Date(latestGenerated).setDate(new Date(latestGenerated).getDate() + 1))
    : new Date(rule.start_date);
  if (rangeStart < new Date(rule.start_date)) {
    // Defensive — shouldn't happen, but never generate before the rule starts.
    rangeStart.setTime(new Date(rule.start_date).getTime());
  }

  const horizon = new Date();
  horizon.setDate(horizon.getDate() + ROLLFORWARD_HORIZON_DAYS);
  const rangeEnd = rule.end_date && new Date(rule.end_date) < horizon ? new Date(rule.end_date) : horizon;

  if (rangeStart > rangeEnd) return 0;

  const dates = computeOccurrenceDates(rule.day_of_week, rangeStart, rangeEnd);
  if (dates.length === 0) return 0;

  const maxCapacity = rule.max_capacity ?? (await getSettingNumber("SESSION_DEFAULT_CAPACITY"));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const date of dates) {
      const startTime = combineDateAndTime(date, rule.start_time_of_day);
      const endTime = combineDateAndTime(date, rule.end_time_of_day);
      await client.query(
        `INSERT INTO sessions
           (session_type, description, start_time, end_time, max_capacity, host_user_id, is_ticketed, recurrence_rule_id)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
        [rule.session_type, rule.description, startTime, endTime, maxCapacity, rule.default_host_user_id, ruleId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return dates.length;
}

/** The function a future EventBridge job (or, for now, `pnpm rollforward`) calls. */
export async function rollforwardAllRules(): Promise<{ ruleId: string; created: number }[]> {
  const rules = await pool.query<{ id: string }>(
    `SELECT id FROM recurrence_rules WHERE end_date IS NULL OR end_date >= CURRENT_DATE`,
  );

  const results: { ruleId: string; created: number }[] = [];
  for (const row of rules.rows) {
    const created = await generateSessionsForRule(row.id);
    results.push({ ruleId: row.id, created });
  }
  return results;
}
