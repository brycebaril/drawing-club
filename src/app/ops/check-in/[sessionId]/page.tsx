import { notFound } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { SiteNav } from "@/components/SiteNav";
import { toggleCheckedInAction } from "./actions";
import { NoteForm } from "./NoteForm";

interface SessionRow {
  session_type: string;
  description: string | null;
  start_time: Date;
  end_time: Date;
  status: string;
  host_user_id: string | null;
  host_username: string | null;
  series_id: string | null;
}

interface AttendeeRow {
  id: string;
  username: string;
  checked_in: boolean;
  seat_number: number | null;
}

interface NoteRow {
  id: string;
  content: string;
  created_at: Date;
  author_username: string;
  base_role: string;
  volunteer_roles: string[];
}

const ROLE_LABELS: Record<string, string> = {
  SessionManager: "Host",
  ContentEditor: "Content Editor",
  ModelBooker: "Model Booker",
  Controller: "Controller",
};

function describeAuthorRole(row: NoteRow): string {
  if (row.base_role === "Admin") return "Admin";
  const labels = row.volunteer_roles.map((role) => ROLE_LABELS[role] ?? role);
  return labels.length > 0 ? labels.join(", ") : "Member";
}

export default async function CheckInPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  const ctx = await requireOpsRole(["VOL_HOST", "VOL_MBR"]);
  if (!ctx) notFound();

  const sessionResult = await pool.query<SessionRow>(
    `SELECT s.session_type, s.description, s.start_time, s.end_time, s.status,
            s.host_user_id, u.username AS host_username, s.series_id
     FROM sessions s
     LEFT JOIN users u ON u.id = s.host_user_id
     WHERE s.id = $1`,
    [sessionId],
  );
  if (sessionResult.rowCount === 0) notFound();
  const session = sessionResult.rows[0];

  const isPrivileged = ctx.roles.includes("ADMIN") || ctx.roles.includes("VOL_MBR");
  const isAssignedHost = ctx.roles.includes("VOL_HOST") && session.host_user_id === ctx.id;
  if (!isPrivileged && !isAssignedHost) notFound();

  const isSeries = session.series_id !== null;

  const rosterResult = isSeries
    ? await pool.query<AttendeeRow>(
        `SELECT sr.id, u.username, sr.checked_in, sr.seat_number
         FROM seat_reservations sr
         JOIN users u ON u.id = sr.user_id
         WHERE sr.session_id = $1
         ORDER BY sr.seat_number`,
        [sessionId],
      )
    : await pool.query<AttendeeRow>(
        `SELECT p.id, u.username, p.checked_in, NULL::integer AS seat_number
         FROM passes p
         JOIN users u ON u.id = p.owner_id
         WHERE p.session_id = $1 AND p.status = 'Used'
         ORDER BY u.username`,
        [sessionId],
      );

  const notesResult = await pool.query<NoteRow>(
    `SELECT sn.id, sn.content, sn.created_at, u.username AS author_username, u.base_role,
            COALESCE(array_agg(vr.role::text) FILTER (WHERE vr.role IS NOT NULL), '{}') AS volunteer_roles
     FROM session_notes sn
     JOIN users u ON u.id = sn.author_user_id
     LEFT JOIN volunteer_roles vr ON vr.user_id = u.id
     WHERE sn.session_id = $1
     GROUP BY sn.id, sn.content, sn.created_at, u.username, u.base_role
     ORDER BY sn.created_at DESC`,
    [sessionId],
  );

  return (
    <>
      <SiteNav />
      <main className="main--wide">
      <h1>
        Check-in — {session.session_type} — {new Date(session.start_time).toLocaleString()}
      </h1>
      <p>
        {new Date(session.start_time).toLocaleTimeString()} – {new Date(session.end_time).toLocaleTimeString()} ·
        Host: {session.host_username ?? "Open"} · Status: {session.status}
      </p>
      {session.description && <p>{session.description}</p>}

      <h2>Roster</h2>
      {rosterResult.rowCount === 0 ? (
        <p>Nobody booked yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
          <thead>
            <tr>
              {isSeries && <th>Seat</th>}
              <th>Name</th>
              <th>Attended</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rosterResult.rows.map((row) => (
              <tr key={row.id}>
                {isSeries && <td>{row.seat_number}</td>}
                <td>{row.username}</td>
                <td>{row.checked_in ? "Checked in" : "Not yet"}</td>
                <td>
                  <form action={toggleCheckedInAction}>
                    <input type="hidden" name="sessionId" value={sessionId} />
                    <input type="hidden" name="rowType" value={isSeries ? "seat" : "pass"} />
                    <input type="hidden" name="rowId" value={row.id} />
                    <button type="submit">{row.checked_in ? "Undo" : "Check in"}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      )}

      <h2>Studio guidelines</h2>
      <p>
        Emergency contact: studio phone line, posted at the front desk. In a medical emergency, call 911 first.
        Models get first choice of pose; keep walkways clear for late arrivals.
      </p>

      <h2>Session notes</h2>
      <p>Visible to the Host, Model Booker, and Admins working this session — not to attendees.</p>
      <NoteForm sessionId={sessionId} />
      {notesResult.rowCount === 0 ? (
        <p>No notes yet.</p>
      ) : (
        <ul>
          {notesResult.rows.map((note) => (
            <li key={note.id}>
              <strong>
                {note.author_username} ({describeAuthorRole(note)})
              </strong>{" "}
              — {new Date(note.created_at).toLocaleString()}
              <br />
              {note.content}
            </li>
          ))}
        </ul>
      )}
    </main>
    </>
  );
}
