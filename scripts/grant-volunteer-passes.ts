/**
 * Manual stand-in for a weekly scheduled job (Sundays 5pm local time, via
 * EventBridge Scheduler once AWS infra is provisioned — same "no scheduler
 * infra yet" reasoning as scripts/generate-payouts.ts and
 * scripts/rollforward.ts). Also triggerable on-demand from /admin/passes
 * (src/app/admin/passes/actions.ts), both calling the same
 * grantWeeklyVolunteerPasses function.
 *
 * Usage: pnpm grant-volunteer-passes
 * Always targets the *current* week — unlike payout reports, there's no
 * legitimate reason to retroactively grant a past week's pass, so no date
 * argument.
 */
import { pool } from "../src/lib/db/pool";
import { grantWeeklyVolunteerPasses } from "../src/lib/ops/volunteerPasses";
import { toDateOnly } from "../src/lib/sessions/shared";

function currentWeekStart(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ...
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - daysSinceMonday);
  return d;
}

async function main() {
  const weekStart = currentWeekStart(new Date());

  const result = await grantWeeklyVolunteerPasses(weekStart);
  console.log(
    `Volunteer pass grants for week of ${toDateOnly(result.weekStart)}: ` +
      `${result.granted.length} volunteer(s) granted, ${result.skippedAtCap.length} at/above cap, ` +
      `${result.alreadyGranted.length} already granted this week.`,
  );
  for (const grant of result.granted) {
    console.log(` - ${grant.userId}: ${grant.grantedCount} ticket(s)`);
  }
}

main()
  .catch((error) => {
    console.error("Volunteer pass grant failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
