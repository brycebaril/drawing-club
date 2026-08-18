import { notFound } from "next/navigation";
import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { SiteNav } from "@/components/SiteNav";
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
  fees: string | null;
}

interface PayoutBatchRow {
  payout_batch_id: string;
  payout_status: string;
  transaction_count: string;
  gross_amount: string;
  total_fees: string | null;
  net_amount: string | null;
  earliest: Date;
  latest: Date;
}

function mostRecentCompletedWeekStart(now: Date): string {
  const mostRecentSunday = new Date(now);
  mostRecentSunday.setHours(0, 0, 0, 0);
  mostRecentSunday.setDate(mostRecentSunday.getDate() - mostRecentSunday.getDay());
  const weekStart = new Date(mostRecentSunday);
  weekStart.setDate(weekStart.getDate() - 6);
  return toDateOnly(weekStart);
}

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const ctx = await requireOpsRole(["VOL_CTRL"]);
  if (!ctx) notFound();

  const { start, end } = await searchParams;
  const now = new Date();
  const rangeEnd = end || toDateOnly(now);
  const rangeStart = start || toDateOnly(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000));

  const weeksResult = await pool.query<WeekSummaryRow>(
    `SELECT week_start_date, week_end_date, count(*) AS models_paid, sum(total_owed) AS total_owed
     FROM model_payout_reports
     GROUP BY week_start_date, week_end_date
     ORDER BY week_start_date DESC
     LIMIT 52`,
  );

  const transactionTotalsResult = await pool.query<TransactionTotalRow>(
    `SELECT item_type, count(*) AS count, sum(amount_paid) AS total, sum(processing_fee) AS fees
     FROM transactions
     WHERE charge_status = 'Succeeded' AND created_at::date BETWEEN $1::date AND $2::date
     GROUP BY item_type
     ORDER BY item_type`,
    [rangeStart, rangeEnd],
  );

  const payoutBatchesResult = await pool.query<PayoutBatchRow>(
    `SELECT payout_batch_id, payout_status, count(*)::int AS transaction_count,
            sum(amount_paid) AS gross_amount, sum(processing_fee) AS total_fees, sum(net_amount) AS net_amount,
            min(created_at) AS earliest, max(created_at) AS latest
     FROM transactions
     WHERE payout_batch_id IS NOT NULL
     GROUP BY payout_batch_id, payout_status
     ORDER BY latest DESC
     LIMIT 100`,
  );

  return (
    <>
      <SiteNav />
      <main>
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
        <div className="table-scroll">
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
        </div>
      )}

      <h2>Payout batch reconciliation</h2>
      <p>Cross-reference a bank deposit against the transactions that make it up.</p>
      {payoutBatchesResult.rowCount === 0 ? (
        <p>No payout batches recorded yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
          <thead>
            <tr>
              <th>Payout batch</th>
              <th>Status</th>
              <th>Transactions</th>
              <th>Gross</th>
              <th>Fees</th>
              <th>Net</th>
              <th>Date range</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {payoutBatchesResult.rows.map((batch) => (
              <tr key={`${batch.payout_batch_id}-${batch.payout_status}`}>
                <td>{batch.payout_batch_id}</td>
                <td>{batch.payout_status}</td>
                <td>{batch.transaction_count}</td>
                <td>${batch.gross_amount}</td>
                <td>{batch.total_fees ? `$${batch.total_fees}` : "—"}</td>
                <td>{batch.net_amount ? `$${batch.net_amount}` : "—"}</td>
                <td>
                  {toDateOnly(new Date(batch.earliest))} – {toDateOnly(new Date(batch.latest))}
                </td>
                <td>
                  <Link href={`/ops/financials/payouts/${encodeURIComponent(batch.payout_batch_id)}`}>
                    View
                  </Link>
                  {" · "}
                  <a href={`/ops/financials/payouts/csv?payoutBatchId=${encodeURIComponent(batch.payout_batch_id)}`}>
                    CSV
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      )}

      <h2>Sales &amp; renewals</h2>
      <form>
        <label htmlFor="start">Start</label>
        <input id="start" name="start" type="date" defaultValue={rangeStart} />
        <label htmlFor="end">End</label>
        <input id="end" name="end" type="date" defaultValue={rangeEnd} />
        <button type="submit">Filter</button>
      </form>
      <p>
        <a href={`/ops/financials/transactions/csv?start=${rangeStart}&end=${rangeEnd}`}>
          Download transactions CSV for this range
        </a>
      </p>
      {transactionTotalsResult.rowCount === 0 ? (
        <p>No transactions in this range.</p>
      ) : (
        <div className="table-scroll">
          <table>
          <thead>
            <tr>
              <th>Item type</th>
              <th>Count</th>
              <th>Total</th>
              <th>Total fees</th>
            </tr>
          </thead>
          <tbody>
            {transactionTotalsResult.rows.map((row) => (
              <tr key={row.item_type}>
                <td>{row.item_type}</td>
                <td>{row.count}</td>
                <td>${row.total}</td>
                <td>{row.fees ? `$${row.fees}` : "—"}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      )}
    </main>
    </>
  );
}
