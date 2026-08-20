import { notFound } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { Badge, statusTone, tierTone } from "@/components/Badge";
import { StatusForm } from "./StatusForm";
import { GrantPassForm } from "./GrantPassForm";
import { MembershipForm } from "./MembershipForm";
import { VolunteerRoleForm } from "./VolunteerRoleForm";
import { removeVolunteerRoleAction } from "./actions";

interface UserDetail {
  id: string;
  username: string;
  display_name: string | null;
  email: string;
  status: "Active" | "Suspended" | "Banned";
  base_role: "AccountHolder" | "Admin";
  membership_expires_at: Date | null;
}

interface MembershipHistoryRow {
  valid_from: Date;
  valid_until: Date;
  granted_by_username: string | null;
}

interface BookingRow {
  session_id: string;
  session_type: string;
  start_time: Date;
}

interface LegacyActivityRow {
  occurred_at: Date;
  event_label: string;
  how_many: number;
  comment: string | null;
  actor_user_id: string | null;
  actor_username: string | null;
  target_user_id: string | null;
  target_username: string | null;
  session_start_time: Date | null;
  session_type: string | null;
  transaction_item_type: string | null;
  transaction_amount: string | null;
}

const VOLUNTEER_ROLE_LABELS: Record<string, string> = {
  SessionManager: "Session Manager (VOL_HOST)",
  ContentEditor: "Content Editor (VOL_MKT)",
  ModelBooker: "Model Booker (VOL_MBR)",
  Controller: "Controller (VOL_CTRL)",
  // No corresponding VOL_* RBAC level — a Board Member's access already
  // comes from base_role='Admin'; this is a descriptive volunteer-type tag,
  // not a route-gating one.
  Board: "Board Member",
  // Was missing here (same gap as filterUsers.ts's own separate copy of
  // this map, fixed alongside this) — a support agent showed as the raw
  // "SupportAgent" DB enum value on this page until now.
  SupportAgent: "Support Agent (VOL_SUPPORT)",
};

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const userResult = await pool.query<UserDetail>(
    `SELECT id, username, display_name, email, status, base_role, membership_expires_at FROM users WHERE id = $1`,
    [id],
  );
  if (userResult.rowCount === 0) notFound();
  const user = userResult.rows[0];

  const [passCountResult, historyResult, volunteerRolesResult, bookingsResult, legacyActivityResult] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT count(*) FROM passes WHERE owner_id = $1 AND status = 'Available'`,
      [id],
    ),
    pool.query<MembershipHistoryRow>(
      `SELECT mh.valid_from, mh.valid_until, gb.username AS granted_by_username
       FROM membership_history mh
       LEFT JOIN users gb ON gb.id = mh.granted_by
       WHERE mh.user_id = $1
       ORDER BY mh.valid_from DESC`,
      [id],
    ),
    pool.query<{ role: string }>(`SELECT role FROM volunteer_roles WHERE user_id = $1`, [id]),
    pool.query<BookingRow>(
      `SELECT s.id AS session_id, s.session_type, s.start_time
       FROM passes p
       JOIN sessions s ON s.id = p.session_id
       WHERE p.owner_id = $1 AND p.status = 'Used' AND s.start_time > now()
       ORDER BY s.start_time ASC`,
      [id],
    ),
    pool.query<LegacyActivityRow>(
      // actor_user_id = $1 OR target_user_id = $1: this user's own legacy
      // activity includes events where an admin/other member acted ON them
      // (e.g. "Admin registered a seat for another member"), not just
      // events they themselves performed — found by code review, the
      // original actor-only WHERE clause silently missed those on exactly
      // the profile they're about.
      `SELECT l.occurred_at, l.event_label, l.how_many, l.comment,
              l.actor_user_id, actor.username AS actor_username,
              l.target_user_id, target.username AS target_username,
              s.start_time AS session_start_time, s.session_type,
              t.item_type::text AS transaction_item_type, t.amount_paid AS transaction_amount
       FROM legacy_registration_logs l
       LEFT JOIN users actor ON actor.id = l.actor_user_id
       LEFT JOIN users target ON target.id = l.target_user_id
       LEFT JOIN sessions s ON s.id = l.session_id
       LEFT JOIN transactions t ON t.id = l.transaction_id
       WHERE l.actor_user_id = $1 OR l.target_user_id = $1
       ORDER BY l.occurred_at DESC
       LIMIT 100`,
      [id],
    ),
  ]);

  const isMember = user.membership_expires_at ? new Date(user.membership_expires_at) > new Date() : false;
  const assignedRoles = volunteerRolesResult.rows.map((r) => r.role);
  const availableRolesToAssign = Object.keys(VOLUNTEER_ROLE_LABELS).filter(
    (r) => !assignedRoles.includes(r),
  );

  return (
    <>
      <SiteNav />
      <main>
      <h1>{user.display_name ?? user.username}</h1>
      <p>
        {user.username} · {user.email}{" "}
        {user.base_role === "Admin" && <Badge tone="admin">ADMIN</Badge>}{" "}
        <Badge tone={statusTone(user.status)}>{user.status}</Badge>{" "}
        <Badge tone={tierTone(isMember)}>{isMember ? "MBR" : "ACCT"}</Badge> · Available passes:{" "}
        {passCountResult.rows[0].count}
      </p>

      <section>
        <h2>Account status</h2>
        <StatusForm userId={user.id} currentStatus={user.status} />
      </section>

      <section>
        <h2>Grant passes</h2>
        <GrantPassForm userId={user.id} />
      </section>

      <section>
        <h2>Membership</h2>
        <p>
          Current expiration: {user.membership_expires_at ? new Date(user.membership_expires_at).toLocaleDateString() : "none"}
        </p>
        <MembershipForm userId={user.id} />
        <h3>History</h3>
        {historyResult.rows.length === 0 ? (
          <p>No membership history.</p>
        ) : (
          <div className="table-scroll">
            <table>
            <thead>
              <tr>
                <th>From</th>
                <th>Until</th>
                <th>Granted by</th>
              </tr>
            </thead>
            <tbody>
              {historyResult.rows.map((row, i) => (
                <tr key={i}>
                  <td>{new Date(row.valid_from).toLocaleDateString()}</td>
                  <td>{new Date(row.valid_until).toLocaleDateString()}</td>
                  <td>{row.granted_by_username ?? "—"}</td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2>Volunteer roles</h2>
        <ul>
          {assignedRoles.map((role) => (
            <li key={role}>
              {VOLUNTEER_ROLE_LABELS[role] ?? role}{" "}
              <form action={removeVolunteerRoleAction} style={{ display: "inline" }}>
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="role" value={role} />
                <button type="submit">Remove</button>
              </form>
            </li>
          ))}
        </ul>
        {availableRolesToAssign.length > 0 && (
          <VolunteerRoleForm userId={user.id} availableRoles={availableRolesToAssign} labels={VOLUNTEER_ROLE_LABELS} />
        )}
      </section>

      <section>
        <h2>Upcoming bookings</h2>
        {bookingsResult.rows.length === 0 ? (
          <p>None.</p>
        ) : (
          <ul>
            {bookingsResult.rows.map((b) => (
              <li key={b.session_id}>
                {b.session_type} — {new Date(b.start_time).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </section>

      {legacyActivityResult.rows.length > 0 && (
        <section>
          <h2>Legacy activity</h2>
          <p className="section-note">
            Pre-cutover history from the previous booking system (Robostrar), for customer-service reference only —
            most recent 100 events, excluding plain logins/logouts.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {legacyActivityResult.rows.map((row, i) => (
                  <tr key={i}>
                    <td>{new Date(row.occurred_at).toLocaleString()}</td>
                    <td>{row.event_label}</td>
                    <td>
                      {row.actor_user_id !== user.id && row.actor_username && <>By {row.actor_username}. </>}
                      {row.target_user_id !== user.id && row.target_username && (
                        <>Involving {row.target_username}. </>
                      )}
                      {row.session_type && row.session_start_time && (
                        <>
                          Session: {row.session_type} on {new Date(row.session_start_time).toLocaleString()}.{" "}
                        </>
                      )}
                      {row.transaction_item_type && (
                        <>
                          Order: {row.transaction_item_type} (${row.transaction_amount}).{" "}
                        </>
                      )}
                      {row.how_many !== 0 && <>Qty: {row.how_many}. </>}
                      {row.comment && <>{row.comment}</>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
    </>
  );
}
