import { pool } from "@/lib/db/pool";
import { getSettingNumber } from "@/lib/settings";
import { clampRangeStart, combineDateAndTime, computeOccurrenceDates } from "./dates";

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

async function loadRule(ruleId: string): Promise<RuleRow | null> {
  const result = await pool.query<RuleRow>(
    `SELECT id, session_type, description, day_of_week, start_time_of_day, end_time_of_day,
            max_capacity, default_host_user_id, start_date, end_date
     FROM recurrence_rules WHERE id = $1`,
    [ruleId],
  );
  return result.rowCount === 0 ? null : result.rows[0];
}

function rangeEndFor(rule: RuleRow): Date {
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + ROLLFORWARD_HORIZON_DAYS);
  return rule.end_date && new Date(rule.end_date) < horizon ? new Date(rule.end_date) : horizon;
}

/** Inserts one `sessions` row per date, using the rule's current parameters, in one transaction. */
async function insertSessionsForDates(ruleId: string, rule: RuleRow, dates: Date[]): Promise<number> {
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

/**
 * Generates any not-yet-created occurrences for `ruleId` up to the
 * rollforward horizon (or the rule's own end_date, if sooner). Always
 * resumes from the latest already-generated occurrence (regardless of that
 * occurrence's status), so calling this repeatedly is safe — it never
 * regenerates or duplicates a date. Note this means it does NOT fill in
 * dates that were canceled and left in place — see `regenerateSessionsForRule`
 * for that (edit-driven) case, which is anchored at an explicit date instead.
 */
export async function generateSessionsForRule(ruleId: string): Promise<number> {
  const rule = await loadRule(ruleId);
  if (!rule) return 0;

  const latestResult = await pool.query<{ max: Date | null }>(
    `SELECT max(start_time) FROM sessions WHERE recurrence_rule_id = $1`,
    [ruleId],
  );
  const latestGenerated = latestResult.rows[0].max;

  const candidateStart = latestGenerated
    ? new Date(new Date(latestGenerated).setDate(new Date(latestGenerated).getDate() + 1))
    : new Date(rule.start_date);
  const rangeStart = clampRangeStart(candidateStart, new Date(rule.start_date));
  const rangeEnd = rangeEndFor(rule);

  if (rangeStart > rangeEnd) return 0;

  const dates = computeOccurrenceDates(rule.day_of_week, rangeStart, rangeEnd);
  return insertSessionsForDates(ruleId, rule, dates);
}

/**
 * Edit-driven regeneration (Phase 7): generates occurrences for `ruleId`
 * from an explicit `fromDate` forward, up to the horizon (or end_date),
 * using the rule's *current* (just-updated) parameters. Unlike
 * `generateSessionsForRule`, this does NOT resume from `MAX(start_time)` —
 * canceling future sessions during an edit doesn't delete or move them, so
 * the old resume point would just skip past the very range an edit needs
 * to refill. Callers are expected to have already canceled any
 * `Scheduled` sessions in `[fromDate, horizon]` before calling this, or
 * duplicate dates could result.
 */
export async function regenerateSessionsForRule(ruleId: string, fromDate: Date): Promise<number> {
  const rule = await loadRule(ruleId);
  if (!rule) return 0;

  const rangeStart = clampRangeStart(fromDate, new Date(rule.start_date));
  const rangeEnd = rangeEndFor(rule);

  if (rangeStart > rangeEnd) return 0;

  const dates = computeOccurrenceDates(rule.day_of_week, rangeStart, rangeEnd);
  return insertSessionsForDates(ruleId, rule, dates);
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
