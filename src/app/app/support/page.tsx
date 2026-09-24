import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { NewTicketForm } from "./NewTicketForm";
import { ORG_TIMEZONE } from "@/lib/org";

interface TicketRow {
  id: string;
  subject: string;
  status: string;
  last_message_at: Date;
  needs_reply: boolean;
}

export default async function SupportPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/app/support");

  const ticketsResult = await pool.query<TicketRow>(
    `SELECT id, subject, status, last_message_at,
            (status = 'Open' AND last_message_by_user_id != requester_user_id) AS needs_reply
     FROM support_tickets
     WHERE requester_user_id = $1
     ORDER BY last_message_at DESC`,
    [session.user.id],
  );

  return (
    <>
      <SiteNav />
      <main>
        <h1>Support</h1>
        <p>
          Questions about your account, bookings, session tickets, or membership.
        </p>

        <h2>New support request</h2>
        <NewTicketForm />

        <h2>Your support requests</h2>
        {ticketsResult.rowCount === 0 ? (
          <p>Nothing to see here.</p>
        ) : (
          <ul>
            {ticketsResult.rows.map((ticket) => (
              <li key={ticket.id}>
                <Link href={`/app/support/${ticket.id}`}>{ticket.subject}</Link>{" "}
                {ticket.needs_reply && <strong className="support-needs-reply">Staff replied — your turn</strong>}
                {" — "}
                {ticket.status} · {new Date(ticket.last_message_at).toLocaleString("en-US", { timeZone: ORG_TIMEZONE })}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
