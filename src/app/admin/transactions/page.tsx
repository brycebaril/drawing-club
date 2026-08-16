import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { AdminNav } from "@/components/AdminNav";

interface TransactionRow {
  id: string;
  username: string | null;
  item_type: string;
  amount_paid: string;
  charge_status: string;
  refunded_amount: string | null;
  payout_status: string;
  created_at: Date;
}

export default async function AdminTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ chargeStatus?: string }>;
}) {
  const { chargeStatus } = await searchParams;

  const result = await pool.query<TransactionRow>(
    `SELECT t.id, u.username, t.item_type, t.amount_paid, t.charge_status,
            t.refunded_amount, t.payout_status, t.created_at
     FROM transactions t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE $1::text IS NULL OR t.charge_status = $1
     ORDER BY t.created_at DESC
     LIMIT 200`,
    [chargeStatus || null],
  );

  return (
    <main>
      <AdminNav />
      <h1>Transactions</h1>
      <form>
        <label htmlFor="chargeStatus">Charge status</label>
        <select id="chargeStatus" name="chargeStatus" defaultValue={chargeStatus ?? ""}>
          <option value="">All</option>
          <option value="Succeeded">Succeeded</option>
          <option value="Failed">Failed</option>
          <option value="Refunded">Refunded</option>
          <option value="Disputed">Disputed</option>
        </select>
        <button type="submit">Filter</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>User</th>
            <th>Item</th>
            <th>Amount paid</th>
            <th>Charge status</th>
            <th>Refunded</th>
            <th>Payout status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.created_at).toLocaleString()}</td>
              <td>{row.username ?? "—"}</td>
              <td>{row.item_type}</td>
              <td>${row.amount_paid}</td>
              <td>{row.charge_status}</td>
              <td>{row.refunded_amount ? `$${row.refunded_amount}` : "—"}</td>
              <td>{row.payout_status}</td>
              <td>
                <Link href={`/admin/transactions/${row.id}`}>View</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
