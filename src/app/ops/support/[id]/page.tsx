import { notFound } from "next/navigation";
import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { SiteNav } from "@/components/SiteNav";
import { ReplyForm } from "@/components/support/ReplyForm";
import { resolveTicketAction, reopenTicketAction } from "@/lib/support/actions";

interface TicketRow {
  id: string;
  subject: string;
  status: string;
  requester_username: string;
}

interface MessageRow {
  id: string;
  content: string;
  created_at: Date;
  author_username: string;
}

export default async function OpsTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOpsRole(["VOL_SUPPORT"]);
  if (!ctx) notFound();

  const ticketResult = await pool.query<TicketRow>(
    `SELECT t.id, t.subject, t.status, u.username AS requester_username
     FROM support_tickets t
     JOIN users u ON u.id = t.requester_user_id
     WHERE t.id = $1`,
    [id],
  );
  if (ticketResult.rowCount === 0) notFound();
  const ticket = ticketResult.rows[0];

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
      <main className="main--wide">
        <p>
          <Link href="/ops/support">&larr; Back to inbox</Link>
        </p>
        <h1>{ticket.subject}</h1>
        <p>
          From: {ticket.requester_username} · Status: {ticket.status}
        </p>

        {ticket.status === "Open" ? (
          <form action={resolveTicketAction}>
            <input type="hidden" name="ticketId" value={id} />
            <button type="submit">Mark resolved</button>
          </form>
        ) : (
          <form action={reopenTicketAction}>
            <input type="hidden" name="ticketId" value={id} />
            <button type="submit">Reopen</button>
          </form>
        )}

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
