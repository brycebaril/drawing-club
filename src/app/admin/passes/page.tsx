import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { AdminNav } from "@/components/AdminNav";
import { PassRowActions } from "./PassRowActions";

interface PassRow {
  id: string;
  owner_username: string | null;
  is_transferable: boolean;
  status: string;
  effective_price: string;
  created_at: Date;
  batch_id: string | null;
  organization_name: string | null;
}

interface BatchOption {
  id: string;
  organization_name: string;
  created_at: Date;
}

const STATUSES = ["Available", "Assigned", "Used", "Revoked"] as const;

function isUnclaimedInventory(pass: PassRow): boolean {
  return pass.is_transferable && pass.owner_username === null && pass.status === "Assigned";
}

export default async function AdminPassesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; batchId?: string }>;
}) {
  const { status, batchId } = await searchParams;

  const passesResult = await pool.query<PassRow>(
    `SELECT p.id, u.username AS owner_username, p.is_transferable, p.status,
            p.effective_price, p.created_at, pb.id AS batch_id, pb.organization_name
     FROM passes p
     LEFT JOIN users u ON u.id = p.owner_id
     LEFT JOIN pass_batches pb ON pb.id = p.batch_id
     WHERE ($1::text IS NULL OR p.status::text = $1)
       AND ($2::uuid IS NULL OR p.batch_id = $2)
     ORDER BY p.created_at DESC
     LIMIT 200`,
    [status || null, batchId || null],
  );

  const batchesResult = await pool.query<BatchOption>(
    `SELECT id, organization_name, created_at FROM pass_batches ORDER BY created_at DESC`,
  );

  return (
    <main>
      <AdminNav />
      <h1>Passes</h1>
      <p>
        <Link href="/admin/passes/new-batch">New batch</Link>
      </p>

      <form>
        <label htmlFor="status">Status</label>
        <select id="status" name="status" defaultValue={status ?? ""}>
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label htmlFor="batchId">Batch</label>
        <select id="batchId" name="batchId" defaultValue={batchId ?? ""}>
          <option value="">All</option>
          {batchesResult.rows.map((batch) => (
            <option key={batch.id} value={batch.id}>
              {batch.organization_name} ({new Date(batch.created_at).toLocaleDateString()})
            </option>
          ))}
        </select>

        <button type="submit">Filter</button>
      </form>

      {passesResult.rowCount === 0 ? (
        <p>No passes match this filter.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Owner</th>
              <th>Transferable</th>
              <th>Status</th>
              <th>Batch / Organization</th>
              <th>Effective price</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {passesResult.rows.map((pass) => (
              <tr key={pass.id}>
                <td>{pass.id.slice(0, 8)}</td>
                <td>{pass.owner_username ?? "Unclaimed"}</td>
                <td>{pass.is_transferable ? "Yes" : "No"}</td>
                <td>{pass.status}</td>
                <td>{pass.organization_name ?? "—"}</td>
                <td>${pass.effective_price}</td>
                <td>{new Date(pass.created_at).toLocaleDateString()}</td>
                <td>{isUnclaimedInventory(pass) ? <PassRowActions passId={pass.id} /> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
