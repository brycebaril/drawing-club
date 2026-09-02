import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { SortableTh } from "@/components/SortableTh";
import { resolveSort } from "@/lib/sort";
import { describeTransactionItemType } from "@/lib/payments/pricing";
import { ORG_TIMEZONE } from "@/lib/org";
import { memberLabelWithUsername } from "@/lib/users/memberLabel";

const SORT_COLUMNS = {
  when: "t.created_at",
  user: "u.username",
  item: "t.item_type",
  amount: "t.amount_paid",
  chargeStatus: "t.charge_status",
  refunded: "t.refunded_amount",
  payoutStatus: "t.payout_status",
} as const;

interface TransactionRow {
  id: string;
  username: string | null;
  display_name: string | null;
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
  searchParams: Promise<{ chargeStatus?: string; sort?: string; dir?: string }>;
}) {
  const { chargeStatus, sort, dir } = await searchParams;
  const { state, orderBy } = resolveSort(sort, dir, SORT_COLUMNS, "when", "desc");
  const currentParams = new URLSearchParams({
    ...(chargeStatus ? { chargeStatus } : {}),
    sort: state.key,
    dir: state.dir,
  });

  const result = await pool.query<TransactionRow>(
    `SELECT t.id, u.username, u.display_name, t.item_type, t.amount_paid, t.charge_status,
            t.refunded_amount, t.payout_status, t.created_at
     FROM transactions t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE $1::text IS NULL OR t.charge_status::text = $1
     ORDER BY ${orderBy}, t.id ASC
     LIMIT 200`,
    [chargeStatus || null],
  );

  return (
    <>
      <SiteNav />
      <main className="main--wide">
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
      <div className="table-scroll">
        <table>
        <thead>
          <tr>
            <SortableTh label="When" columnKey="when" pathname="/admin/transactions" currentParams={currentParams} current={state} />
            <SortableTh label="User" columnKey="user" pathname="/admin/transactions" currentParams={currentParams} current={state} />
            <SortableTh label="Item" columnKey="item" pathname="/admin/transactions" currentParams={currentParams} current={state} />
            <SortableTh
              label="Amount paid"
              columnKey="amount"
              pathname="/admin/transactions"
              currentParams={currentParams}
              current={state}
            />
            <SortableTh
              label="Charge status"
              columnKey="chargeStatus"
              pathname="/admin/transactions"
              currentParams={currentParams}
              current={state}
            />
            <SortableTh
              label="Refunded"
              columnKey="refunded"
              pathname="/admin/transactions"
              currentParams={currentParams}
              current={state}
            />
            <SortableTh
              label="Payout status"
              columnKey="payoutStatus"
              pathname="/admin/transactions"
              currentParams={currentParams}
              current={state}
            />
            <th></th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.created_at).toLocaleString("en-US", { timeZone: ORG_TIMEZONE })}</td>
              <td>{row.username ? memberLabelWithUsername(row.display_name, row.username) : "—"}</td>
              <td>{describeTransactionItemType(row.item_type)}</td>
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
      </div>
    </main>
    </>
  );
}
