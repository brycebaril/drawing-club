import { notFound } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { OpsNav } from "@/components/OpsNav";
import { toDateOnly } from "@/lib/sessions/shared";
import { GenerateReportForm } from "./GenerateReportForm";

interface WeekSummaryRow {
  week_start_date: Date;
  week_end_date: Date;
  models_paid: string;
  total_owed: string;
}

interface TransactionTotalRow {
  item_type: string;
  count: string;
  total: string;
}

function mostRecentCompletedWeekStart(now: Date): string {
  const mostRecentSunday = new Date(now);
  mostRecentSunday.setHours(0, 0, 0, 0);
  mostRecentSunday.setDate(mostRecentSunday.getDate() - mostRecentSunday.getDay());
  const weekStart = new Date(mostRecentSunday);
  weekStart.setDate(weekStart.getDate() - 6);
  return toDateOnly(weekStart);
}

export default async function FinancialsPage() {
  const ctx = await requireOpsRole(["VOL_CTRL"]);
  if (!ctx) notFound();

  const weeksResult = await pool.query<WeekSummaryRow>(
    `SELECT week_start_date, week_end_date, count(*) AS models_paid, sum(total_owed) AS total_owed
     FROM model_payout_reports
     GROUP BY week_start_date, week_end_date
     ORDER BY week_start_date DESC
     LIMIT 52`,
  );

  const transactionTotalsResult = await pool.query<TransactionTotalRow>(
    `SELECT item_type, count(*) AS count, sum(amount_paid) AS total
     FROM transactions
     WHERE charge_status = 'Succeeded' AND created_at >= now() - interval '90 days'
     GROUP BY item_type
     ORDER BY item_type`,
  );

  return (
    <main>
      <OpsNav roles={ctx.roles} />
      <h1>Financials</h1>

      <h2>Generate model payout report</h2>
      <p>
        Emails the Controller and Model Booker volunteers, same as the weekly report this replaces. Sessions
        worked are counted Monday through the following Sunday.
      </p>
      <GenerateReportForm defaultWeekStart={mostRecentCompletedWeekStart(new Date())} />

      <h2>Payout report history</h2>
      {weeksResult.rowCount === 0 ? (
        <p>No reports generated yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Week</th>
              <th>Models paid</th>
              <th>Total owed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {weeksResult.rows.map((week) => {
              const weekStartStr = toDateOnly(new Date(week.week_start_date));
              return (
                <tr key={weekStartStr}>
                  <td>
                    {weekStartStr} – {toDateOnly(new Date(week.week_end_date))}
                  </td>
                  <td>{week.models_paid}</td>
                  <td>${week.total_owed}</td>
                  <td>
                    <a href={`/ops/financials/csv?weekStart=${weekStartStr}`}>Download CSV</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2>Sales &amp; renewals (last 90 days)</h2>
      {transactionTotalsResult.rowCount === 0 ? (
        <p>No transactions in this window.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Item type</th>
              <th>Count</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {transactionTotalsResult.rows.map((row) => (
              <tr key={row.item_type}>
                <td>{row.item_type}</td>
                <td>{row.count}</td>
                <td>${row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
