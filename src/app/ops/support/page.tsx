import { notFound } from "next/navigation";
import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { SiteNav } from "@/components/SiteNav";

interface TicketRow {
  id: string;
  subject: string;
  status: string;
  last_message_at: Date;
  requester_username: string;
  needs_staff_reply: boolean;
}

/**
 * Shared inbox — any VOL_SUPPORT/ADMIN can see and reply to any ticket
 * (no per-ticket assignment), matching the existing unscoped VOL_MBR
 * check-in precedent rather than check-in's per-host resource scoping.
 */
export default async function SupportInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const ctx = await requireOpsRole(["VOL_SUPPORT"]);
  if (!ctx) notFound();

  const { filter } = await searchParams;
  const statusFilter = filter === "resolved" ? "Resolved" : filter === "all" ? null : "Open";

  const ticketsResult = await pool.query<TicketRow>(
    `SELECT t.id, t.subject, t.status, t.last_message_at, u.username AS requester_username,
            (t.status = 'Open' AND t.last_message_by_user_id = t.requester_user_id) AS needs_staff_reply
     FROM support_tickets t
     JOIN users u ON u.id = t.requester_user_id
     WHERE $1::text IS NULL OR t.status::text = $1
     ORDER BY needs_staff_reply DESC, t.last_message_at DESC`,
    [statusFilter],
  );

  return (
    <>
      <SiteNav />
      <main className="main--wide">
        <h1>Support inbox</h1>
        <form>
          <label htmlFor="filter">Show</label>
          <select id="filter" name="filter" defaultValue={filter ?? "open"}>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
          <button type="submit">Apply</button>
        </form>

        {ticketsResult.rowCount === 0 ? (
          <p>No tickets.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>From</th>
                  <th>Status</th>
                  <th>Last activity</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ticketsResult.rows.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>{ticket.subject}</td>
                    <td>{ticket.requester_username}</td>
                    <td>{ticket.status}</td>
                    <td>{new Date(ticket.last_message_at).toLocaleString()}</td>
                    <td>
                      <Link href={`/ops/support/${ticket.id}`}>
                        {ticket.needs_staff_reply ? "Needs reply" : "Open"}
                      </Link>
                    </td>
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
