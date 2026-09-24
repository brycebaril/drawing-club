import { pool } from "@/lib/db/pool";
import { getSettingNumber } from "@/lib/settings";
import { toDateOnly } from "@/lib/sessions/shared";

export interface VolunteerEligibility {
  userId: string;
  currentAvailableCount: number;
}

export interface GrantDecision {
  userId: string;
  /** 0 means "skip this week" — already at/above the cap. */
  grantedCount: number;
}

/**
 * Pure decision core — "as long as they currently hold fewer than the cap"
 * (the feature's own original wording): at/above cap skips the grant
 * entirely for the week, it does not top up to the cap. Split out from the
 * DB-touching wrapper below so this can be unit tested directly, same
 * reasoning as payouts.ts's computePayouts.
 */
export function computeGrantDecisions(
  eligibility: VolunteerEligibility[],
  weeklyAllowance: number,
  cap: number,
): GrantDecision[] {
  return eligibility.map((e) => ({
    userId: e.userId,
    grantedCount: e.currentAvailableCount < cap ? weeklyAllowance : 0,
  }));
}

export interface GrantWeeklyVolunteerPassesResult {
  weekStart: Date;
  granted: GrantDecision[];
  /** Eligible but already at/above VOLUNTEER_PASS_WALLET_CAP this run. */
  skippedAtCap: string[];
  /** Eligible and under cap, but volunteer_pass_grants already has a row for this user/week (safe re-run). */
  alreadyGranted: string[];
}

/**
 * `weekStart` must be a Monday, matching generatePayoutReports's own
 * convention — always targets the *current* week (unlike payout reports,
 * there's no legitimate reason to backdate a volunteer pass grant, so the
 * CLI/admin callers never pass an arbitrary past date).
 *
 * Eligibility is "holds the GenericVolunteer volunteer_roles row" — NOT any
 * VOL_* RBAC role, and not a separate flag (see the migration that adds the
 * role for why). Idempotent per user/week via
 * volunteer_pass_grants_user_week_unique's ON CONFLICT DO NOTHING — calling
 * this twice for the same week (a double click on the admin button, then
 * the CLI script, or vice versa) never double-grants.
 */
export async function grantWeeklyVolunteerPasses(weekStart: Date): Promise<GrantWeeklyVolunteerPassesResult> {
  const [allowance, cap] = await Promise.all([
    getSettingNumber("VOLUNTEER_WEEKLY_PASS_ALLOWANCE"),
    getSettingNumber("VOLUNTEER_PASS_WALLET_CAP"),
  ]);

  const eligibleResult = await pool.query<{ user_id: string; current_count: string }>(
    `SELECT u.id AS user_id,
            count(p.id) FILTER (WHERE p.status = 'Available' AND p.is_volunteer_grant = true) AS current_count
     FROM users u
     JOIN volunteer_roles vr ON vr.user_id = u.id AND vr.role = 'GenericVolunteer'
     LEFT JOIN passes p ON p.owner_id = u.id
     WHERE u.status = 'Active'
     GROUP BY u.id`,
  );

  const eligibility: VolunteerEligibility[] = eligibleResult.rows.map((r) => ({
    userId: r.user_id,
    currentAvailableCount: Number(r.current_count),
  }));
  const decisions = computeGrantDecisions(eligibility, allowance, cap);

  const granted: GrantDecision[] = [];
  const skippedAtCap: string[] = [];
  const alreadyGranted: string[] = [];

  for (const decision of decisions) {
    if (decision.grantedCount === 0) {
      skippedAtCap.push(decision.userId);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // The idempotency row is inserted FIRST — a conflict here means this
      // user already got their grant for this week, so nothing else in this
      // transaction should run.
      const grantRow = await client.query(
        `INSERT INTO volunteer_pass_grants (user_id, week_start_date, granted_count)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, week_start_date) DO NOTHING
         RETURNING id`,
        [decision.userId, toDateOnly(weekStart), decision.grantedCount],
      );
      if (grantRow.rowCount === 0) {
        await client.query("ROLLBACK");
        alreadyGranted.push(decision.userId);
        continue;
      }

      for (let i = 0; i < decision.grantedCount; i++) {
        await client.query(
          `INSERT INTO passes (owner_id, status, is_transferable, effective_price, is_volunteer_grant)
           VALUES ($1, 'Available', false, 0, true)`,
          [decision.userId],
        );
      }
      await client.query("COMMIT");
      granted.push(decision);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return { weekStart, granted, skippedAtCap, alreadyGranted };
}
