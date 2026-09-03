import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { SortableTh } from "@/components/SortableTh";
import { resolveSort } from "@/lib/sort";
import { PassRowActions } from "./PassRowActions";
import { ORG_TIMEZONE } from "@/lib/org";
import { memberLabelWithUsername } from "@/lib/users/memberLabel";

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

interface RecentGrantRow {
  id: string;
  week_start_date: Date;
  granted_count: number;
  created_at: Date;
  username: string;
  display_name: string | null;
}

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

  // volunteer_pass_grants only ever gets a row when a grant actually
  // happened (grantWeeklyVolunteerPasses skips the insert entirely for
  // anyone at/above cap) — so every row here is a real grant, not a
  // decision log. This replaces the old "click a button, see one ephemeral
  // result banner" flow with a standing, always-visible record of what the
  // scheduled job has actually done recently.
  const recentGrantsResult = await pool.query<RecentGrantRow>(
    `SELECT vpg.id, vpg.week_start_date, vpg.granted_count, vpg.created_at, u.username, u.display_name
     FROM volunteer_pass_grants vpg
     JOIN users u ON u.id = vpg.user_id
     WHERE vpg.created_at >= now() - interval '7 days'
     ORDER BY vpg.created_at DESC`,
  );

  return (
    <>
      <SiteNav />
      <main className="main--wide">
      <h1>Tickets</h1>
      <p>
        <Link href="/admin/passes/new-batch">New batch</Link>
      </p>

      <section>
        <h2>Volunteer weekly tickets</h2>
        <p className="section-note">
          Runs automatically once a week — there&apos;s nothing to click here. Every member
          currently holding the <strong>General Volunteer</strong> role (assigned per-member on
          their <Link href="/admin/users">account page</Link>, not the same as any staff/ops
          role) gets{" "}
          <strong>
            <code>VOLUNTEER_WEEKLY_PASS_ALLOWANCE</code>
          </strong>{" "}
          free ticket(s), but only if they currently hold <em>fewer than</em>{" "}
          <strong>
            <code>VOLUNTEER_PASS_WALLET_CAP</code>
          </strong>{" "}
          unspent volunteer-granted tickets — someone at or above the cap is skipped entirely for
          that week, not topped up to the cap. Both numbers are admin-editable on{" "}
          <Link href="/admin/settings">Settings</Link>. Safe to trigger more than once in the same
          week (e.g. a manual re-run after debugging) — a repeat run grants nothing new to anyone
          already granted.
        </p>
        {recentGrantsResult.rowCount === 0 ? (
          <p>No volunteer ticket grants in the past 7 days.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Granted</th>
                  <th>Member</th>
                  <th>Week of</th>
                  <th>Tickets</th>
                </tr>
              </thead>
              <tbody>
                {recentGrantsResult.rows.map((grant) => (
                  <tr key={grant.id}>
                    <td>{new Date(grant.created_at).toLocaleString("en-US", { timeZone: ORG_TIMEZONE })}</td>
                    <td>{memberLabelWithUsername(grant.display_name, grant.username)}</td>
                    <td>{new Date(grant.week_start_date).toLocaleDateString("en-US", { timeZone: ORG_TIMEZONE })}</td>
                    <td>{grant.granted_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
