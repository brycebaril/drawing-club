import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { SortableTh } from "@/components/SortableTh";
import { resolveSort } from "@/lib/sort";
import { PassRowActions } from "./PassRowActions";
import { ORG_TIMEZONE } from "@/lib/org";

const SORT_COLUMNS = {
  owner: "owner.username",
  transferable: "p.is_transferable",
  status: "p.status",
  batch: "pb.organization_name",
  price: "p.effective_price",
  basis: "p.cost_basis_source",
  created: "p.created_at",
} as const;

interface PassRow {
  id: string;
  owner_username: string | null;
  pending_recipient_username: string | null;
  is_transferable: boolean;
  status: string;
  effective_price: string;
  cost_basis_source: "Exact" | "Estimated";
  created_at: Date;
  batch_id: string | null;
  organization_name: string | null;
}

const COST_BASIS_SOURCES = ["Exact", "Estimated"] as const;

interface BatchOption {
  id: string;
  organization_name: string;
  created_at: Date;
}

const STATUSES = ["Available", "Assigned", "Used", "Forfeited", "Revoked"] as const;

/** Any unspent transferable pass is eligible for admin revocation — matches revokePassAction's own scope. */
function isRevocable(pass: PassRow): boolean {
  return pass.is_transferable && (pass.status === "Available" || pass.status === "Assigned");
}

export default async function AdminPassesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; batchId?: string; costBasisSource?: string; sort?: string; dir?: string }>;
}) {
  const { status, batchId, costBasisSource, sort, dir } = await searchParams;
  const { state, orderBy } = resolveSort(sort, dir, SORT_COLUMNS, "created", "desc");
  const currentParams = new URLSearchParams({
    ...(status ? { status } : {}),
    ...(batchId ? { batchId } : {}),
    ...(costBasisSource ? { costBasisSource } : {}),
    sort: state.key,
    dir: state.dir,
  });

  const passesResult = await pool.query<PassRow>(
    `SELECT p.id, owner.username AS owner_username, recipient.username AS pending_recipient_username,
            p.is_transferable, p.status, p.effective_price, p.cost_basis_source::text AS cost_basis_source, p.created_at,
            pb.id AS batch_id, pb.organization_name
     FROM passes p
     LEFT JOIN users owner ON owner.id = p.owner_id
     LEFT JOIN users recipient ON recipient.id = p.pending_recipient_id
     LEFT JOIN pass_batches pb ON pb.id = p.batch_id
     WHERE ($1::text IS NULL OR p.status::text = $1)
       AND ($2::uuid IS NULL OR p.batch_id = $2)
       AND ($3::text IS NULL OR p.cost_basis_source::text = $3)
     ORDER BY ${orderBy}, p.id ASC
     LIMIT 200`,
    [status || null, batchId || null, costBasisSource || null],
  );

  const batchesResult = await pool.query<BatchOption>(
    `SELECT id, organization_name, created_at FROM pass_batches ORDER BY created_at DESC`,
  );

  return (
    <>
      <SiteNav />
      <main className="main--wide">
      <h1>Tickets</h1>
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
              {batch.organization_name} ({new Date(batch.created_at).toLocaleDateString("en-US", { timeZone: ORG_TIMEZONE })})
            </option>
          ))}
        </select>

        <label htmlFor="costBasisSource">Cost basis</label>
        <select id="costBasisSource" name="costBasisSource" defaultValue={costBasisSource ?? ""}>
          <option value="">All</option>
          {COST_BASIS_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <button type="submit">Filter</button>
      </form>

      {passesResult.rowCount === 0 ? (
        <p>No tickets match this filter.</p>
      ) : (
        <div className="table-scroll">
          <table>
          <thead>
            <tr>
              <th>ID</th>
              <SortableTh label="Owner" columnKey="owner" pathname="/admin/passes" currentParams={currentParams} current={state} />
              <SortableTh
                label="Transferable"
                columnKey="transferable"
                pathname="/admin/passes"
                currentParams={currentParams}
                current={state}
              />
              <SortableTh label="Status" columnKey="status" pathname="/admin/passes" currentParams={currentParams} current={state} />
              <SortableTh
                label="Batch / Organization"
                columnKey="batch"
                pathname="/admin/passes"
                currentParams={currentParams}
                current={state}
              />
              <SortableTh
                label="Effective price"
                columnKey="price"
                pathname="/admin/passes"
                currentParams={currentParams}
                current={state}
              />
              <SortableTh label="Basis" columnKey="basis" pathname="/admin/passes" currentParams={currentParams} current={state} />
              <SortableTh label="Created" columnKey="created" pathname="/admin/passes" currentParams={currentParams} current={state} />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {passesResult.rows.map((pass) => (
              <tr key={pass.id}>
                <td>{pass.id.slice(0, 8)}</td>
                <td>
                  {pass.owner_username ?? "—"}
                  {pass.pending_recipient_username && ` (pending transfer to ${pass.pending_recipient_username})`}
                </td>
                <td>{pass.is_transferable ? "Yes" : "No"}</td>
                <td>{pass.status}</td>
                <td>{pass.organization_name ?? "—"}</td>
                <td>${pass.effective_price}</td>
                <td>{pass.cost_basis_source}</td>
                <td>{new Date(pass.created_at).toLocaleDateString("en-US", { timeZone: ORG_TIMEZONE })}</td>
                <td>{isRevocable(pass) ? <PassRowActions passId={pass.id} /> : "—"}</td>
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
