import { notFound } from "next/navigation";
import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { SiteNav } from "@/components/SiteNav";
import { ReplyForm } from "@/components/support/ReplyForm";
import { resolveTicketAction, reopenTicketAction } from "@/lib/support/actions";
import { ORG_TIMEZONE } from "@/lib/org";
import { memberLabelWithUsername } from "@/lib/users/memberLabel";

interface TicketRow {
  id: string;
  subject: string;
  status: string;
  requester_username: string;
  requester_display_name: string | null;
}

interface MessageRow {
  id: string;
  content: string;
  created_at: Date;
  author_username: string;
  author_display_name: string | null;
}

export default async function OpsTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireOpsRole(["VOL_SUPPORT"]);
  if (!ctx) notFound();

  const ticketResult = await pool.query<TicketRow>(
    `SELECT t.id, t.subject, t.status, u.username AS requester_username, u.display_name AS requester_display_name
     FROM support_tickets t
     JOIN users u ON u.id = t.requester_user_id
     WHERE t.id = $1`,
    [id],
  );
  if (ticketResult.rowCount === 0) notFound();
  const ticket = ticketResult.rows[0];

  const messagesResult = await pool.query<MessageRow>(
    `SELECT sm.id, sm.content, sm.created_at, u.username AS author_username, u.display_name AS author_display_name
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
          From: {memberLabelWithUsername(ticket.requester_display_name, ticket.requester_username)} · Status: {ticket.status}
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
              <strong>{memberLabelWithUsername(message.author_display_name, message.author_username)}</strong> — {new Date(message.created_at).toLocaleString("en-US", { timeZone: ORG_TIMEZONE })}
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
