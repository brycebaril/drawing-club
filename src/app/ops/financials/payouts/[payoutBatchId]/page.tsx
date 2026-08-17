import { notFound } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { OpsNav } from "@/components/OpsNav";

interface BatchTransactionRow {
  id: string;
  username: string | null;
  item_type: string;
  amount_paid: string;
  processing_fee: string | null;
  net_amount: string | null;
  gateway_ref_id: string;
  created_at: Date;
}

/**
 * Self-contained — renders every column a VOL_CTRL user needs directly,
 * rather than linking out to /admin/transactions/[id] (ADMIN-only via the
 * /admin/* catch-all rbac rule), so a Controller reconciling a payout never
 * hits a permission wall.
 */
export default async function PayoutBatchDetailPage({
  params,
}: {
  params: Promise<{ payoutBatchId: string }>;
}) {
  const { payoutBatchId } = await params;

  const ctx = await requireOpsRole(["VOL_CTRL"]);
  if (!ctx) notFound();

  const result = await pool.query<BatchTransactionRow>(
    `SELECT t.id, u.username, t.item_type, t.amount_paid, t.processing_fee, t.net_amount,
            t.gateway_ref_id, t.created_at
     FROM transactions t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.payout_batch_id = $1
     ORDER BY t.created_at`,
    [payoutBatchId],
  );
  if (result.rowCount === 0) notFound();

  return (
    <main>
      <OpsNav roles={ctx.roles} />
      <h1>Payout batch {payoutBatchId}</h1>
      <p>
        <a href={`/ops/financials/payouts/csv?payoutBatchId=${encodeURIComponent(payoutBatchId)}`}>
          Download CSV
        </a>
      </p>
      <table>
        <thead>
          <tr>
            <th>Buyer</th>
            <th>Item type</th>
            <th>Amount paid</th>
            <th>Fee</th>
            <th>Net</th>
            <th>Gateway reference</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.id}>
              <td>{row.username ?? "—"}</td>
              <td>{row.item_type}</td>
              <td>${row.amount_paid}</td>
              <td>{row.processing_fee ? `$${row.processing_fee}` : "—"}</td>
              <td>{row.net_amount ? `$${row.net_amount}` : "—"}</td>
              <td>{row.gateway_ref_id}</td>
              <td>{new Date(row.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
