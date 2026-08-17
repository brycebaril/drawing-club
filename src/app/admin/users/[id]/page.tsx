import { notFound } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { StatusForm } from "./StatusForm";
import { GrantPassForm } from "./GrantPassForm";
import { MembershipForm } from "./MembershipForm";
import { VolunteerRoleForm } from "./VolunteerRoleForm";
import { removeVolunteerRoleAction } from "./actions";

interface UserDetail {
  id: string;
  username: string;
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

const VOLUNTEER_ROLE_LABELS: Record<string, string> = {
  SessionManager: "Session Manager (VOL_HOST)",
  ContentEditor: "Content Editor (VOL_MKT)",
  ModelBooker: "Model Booker (VOL_MBR)",
  Controller: "Controller (VOL_CTRL)",
};

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const userResult = await pool.query<UserDetail>(
    `SELECT id, username, email, status, base_role, membership_expires_at FROM users WHERE id = $1`,
    [id],
  );
  if (userResult.rowCount === 0) notFound();
  const user = userResult.rows[0];

  const [passCountResult, historyResult, volunteerRolesResult, bookingsResult] = await Promise.all([
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
      <h1>{user.username}</h1>
      <p>
        {user.email} · {user.base_role} · Status: {user.status} · Tier: {isMember ? "MBR" : "ACCT"} ·
        Available passes: {passCountResult.rows[0].count}
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
    </main>
    </>
  );
}
