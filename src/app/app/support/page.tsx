import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { NewTicketForm } from "./NewTicketForm";

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
          Questions about your account, bookings, passes, or membership. For trouble signing in before you can
          reach this page, use the <Link href="/contact">Contact</Link> form instead.
        </p>

        <h2>New ticket</h2>
        <NewTicketForm />

        <h2>Your tickets</h2>
        {ticketsResult.rowCount === 0 ? (
          <p>No support tickets yet.</p>
        ) : (
          <ul>
            {ticketsResult.rows.map((ticket) => (
              <li key={ticket.id}>
                <Link href={`/app/support/${ticket.id}`}>{ticket.subject}</Link>{" "}
                {ticket.needs_reply && <strong className="support-needs-reply">Staff replied — your turn</strong>}
                {" — "}
                {ticket.status} · {new Date(ticket.last_message_at).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
