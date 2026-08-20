import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { ReplyForm } from "@/components/support/ReplyForm";

interface TicketRow {
  id: string;
  subject: string;
  status: string;
  requester_user_id: string;
}

interface MessageRow {
  id: string;
  content: string;
  created_at: Date;
  author_username: string;
}

export default async function MemberTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/auth/login?redirect=/app/support/${id}`);

  const ticketResult = await pool.query<TicketRow>(
    `SELECT id, subject, status, requester_user_id FROM support_tickets WHERE id = $1`,
    [id],
  );
  if (ticketResult.rowCount === 0) notFound();
  const ticket = ticketResult.rows[0];
  // Resource-scoped: a member may only see their own ticket, same discipline
  // as /ops/check-in/[sessionId]'s host-assignment check.
  if (ticket.requester_user_id !== session.user.id) notFound();

  const messagesResult = await pool.query<MessageRow>(
    `SELECT sm.id, sm.content, sm.created_at, u.username AS author_username
     FROM support_ticket_messages sm
     JOIN users u ON u.id = sm.author_user_id
     WHERE sm.ticket_id = $1
     ORDER BY sm.created_at ASC`,
    [id],
  );

  return (
    <>
      <SiteNav />
      <main>
        <p>
          <Link href="/app/support">&larr; Back to your tickets</Link>
        </p>
        <h1>{ticket.subject}</h1>
        <p>Status: {ticket.status}</p>

        <ul>
          {messagesResult.rows.map((message) => (
            <li key={message.id}>
              <strong>{message.author_username}</strong> — {new Date(message.created_at).toLocaleString()}
              <br />
              {message.content}
            </li>
          ))}
        </ul>

        <h2>Reply</h2>
        <ReplyForm ticketId={id} />
      </main>
    </>
  );
}
