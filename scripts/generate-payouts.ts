/**
 * Manual stand-in for the weekly scheduled job ArchitectureDocument.md §8
 * specs (Sundays 5pm local time, via EventBridge Scheduler once AWS infra
 * is provisioned — see docs/ArchitectureDocument.md §8). Until then, this
 * is what actually produces a payout report; also triggerable on-demand
 * from /ops/financials (src/app/ops/financials/actions.ts), both calling
 * the same generatePayoutReports/sendPayoutReportEmail functions.
 *
 * Usage: pnpm generate-payouts [YYYY-MM-DD]
 * The date, if given, must be a Monday — it's the week's start. Omit it to
 * generate the most recently completed Monday-Sunday week.
 */
import { pool } from "../src/lib/db/pool";
import { generatePayoutReports, sendPayoutReportEmail } from "../src/lib/ops/payouts";
import { parseDateOnly, toDateOnly } from "../src/lib/sessions/shared";

function mostRecentCompletedWeekStart(now: Date): Date {
  const mostRecentSunday = new Date(now);
  mostRecentSunday.setHours(0, 0, 0, 0);
  mostRecentSunday.setDate(mostRecentSunday.getDate() - mostRecentSunday.getDay());
  const weekStart = new Date(mostRecentSunday);
  weekStart.setDate(weekStart.getDate() - 6);
  return weekStart;
}

async function main() {
  const arg = process.argv[2];
  const weekStart = arg ? parseDateOnly(arg) : mostRecentCompletedWeekStart(new Date());
  if (weekStart.getDay() !== 1) {
    throw new Error(`weekStart must be a Monday — got ${toDateOnly(weekStart)} (${arg ? "from argument" : "computed"})`);
  }

  const result = await generatePayoutReports(weekStart);
  console.log(
    `Payout report for ${toDateOnly(result.weekStart)} - ${toDateOnly(result.weekEnd)}: ` +
      `${result.generated.length} model(s) generated, ${result.skipped.length} already existed.`,
  );
  for (const payout of result.generated) {
    console.log(` - ${payout.modelName}: ${payout.sessionsWorked} session(s), $${payout.totalOwed.toFixed(2)}`);
  }

  await sendPayoutReportEmail(result);
}

main()
  .catch((error) => {
    console.error("Payout report generation failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
