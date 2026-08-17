import { notFound } from "next/navigation";
import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { RefundForm } from "./RefundForm";

interface TransactionDetail {
  id: string;
  user_id: string;
  username: string | null;
  gateway_ref_id: string;
  amount_paid: string;
  processing_fee: string | null;
  net_amount: string | null;
  charge_status: string;
  refunded_amount: string | null;
  payout_batch_id: string | null;
  payout_status: string;
  item_type: string;
  created_at: Date;
}

interface PassRow {
  id: string;
  status: string;
  effective_price: string;
}

export default async function AdminTransactionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const result = await pool.query<TransactionDetail>(
    `SELECT t.id, t.user_id, u.username, t.gateway_ref_id, t.amount_paid, t.processing_fee,
            t.net_amount, t.charge_status, t.refunded_amount, t.payout_batch_id, t.payout_status,
            t.item_type, t.created_at
     FROM transactions t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.id = $1`,
    [id],
  );
  if (result.rowCount === 0) notFound();
  const transaction = result.rows[0];

  const passResult = await pool.query<PassRow>(
    `SELECT id, status, effective_price FROM passes WHERE transaction_id = $1 ORDER BY id`,
    [id],
  );

  const remaining = Number(transaction.amount_paid) - Number(transaction.refunded_amount ?? 0);
  const canRefund = (transaction.charge_status === "Succeeded" || transaction.charge_status === "Refunded") && remaining > 0;

  return (
    <>
      <SiteNav />
      <main>
      <h1>Transaction</h1>
      <p>
        Buyer:{" "}
        {transaction.username ? (
          <Link href={`/admin/users/${transaction.user_id}`}>{transaction.username}</Link>
        ) : (
          "—"
        )}
      </p>
      <p>Item: {transaction.item_type}</p>
      <p>Amount paid: ${transaction.amount_paid}</p>
      <p>Processing fee: {transaction.processing_fee ? `$${transaction.processing_fee}` : "—"}</p>
      <p>Net amount: {transaction.net_amount ? `$${transaction.net_amount}` : "—"}</p>
      <p>Charge status: {transaction.charge_status}</p>
      <p>Refunded: {transaction.refunded_amount ? `$${transaction.refunded_amount}` : "—"}</p>
      <p>Payout status: {transaction.payout_status}</p>
      <p>Payout batch: {transaction.payout_batch_id ?? "—"}</p>
      <p>Gateway reference: {transaction.gateway_ref_id}</p>
      <p>Created: {new Date(transaction.created_at).toLocaleString()}</p>

      {passResult.rowCount! > 0 && (
        <>
          <h2>Passes from this purchase</h2>
          <p>
            Revoking an unspent pass is a separate action, taken from the buyer&apos;s own{" "}
            <Link href={`/admin/users/${transaction.user_id}`}>user page</Link> — refunding here
            does not automatically revoke anything (Design Doc §7.1).
          </p>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Effective price</th>
              </tr>
            </thead>
            <tbody>
              {passResult.rows.map((pass) => (
                <tr key={pass.id}>
                  <td>{pass.status}</td>
                  <td>${pass.effective_price}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {canRefund ? (
        <RefundForm transactionId={transaction.id} remaining={remaining} />
      ) : (
        <p>This transaction can&apos;t be refunded further.</p>
      )}
    </main>
    </>
  );
}
