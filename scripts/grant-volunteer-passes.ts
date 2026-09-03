/**
 * Manual/local-dev escape hatch only — the real weekly grant runs via a
 * genuine scheduled trigger now: a GitHub Actions cron workflow
 * (.github/workflows/grant-volunteer-passes.yml) calling the protected
 * POST /api/jobs/grant-volunteer-passes route (src/app/api/jobs/
 * grant-volunteer-passes/route.ts), which calls this exact same
 * grantWeeklyVolunteerPasses function. There is deliberately no admin-UI
 * button for this anymore (removed — a real weekly grant shouldn't depend
 * on a person remembering to click something); this script is for running
 * it by hand locally or against staging when debugging.
 *
 * Usage: pnpm grant-volunteer-passes
 * Always targets the *current* week — unlike payout reports, there's no
 * legitimate reason to retroactively grant a past week's pass, so no date
 * argument.
 */
import { pool } from "../src/lib/db/pool";
import { grantWeeklyVolunteerPasses } from "../src/lib/ops/volunteerPasses";
import { currentWeekStart, toDateOnly } from "../src/lib/sessions/shared";

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
