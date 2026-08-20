"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { pool } from "@/lib/db/pool";
import { getUserAuthContext } from "@/lib/auth/roles";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { writeAuditLog } from "@/lib/audit/log";
import { sendEmail } from "@/lib/email/sender";

/**
 * Support-ticket mutations, shared by both /app/support (the requesting
 * member) and /ops/support (VOL_SUPPORT/ADMIN) — creation, replying, and
 * resolving all touch the same two tables and need the same transactional
 * discipline, so this isn't split ops/app-side the way most other features
 * in this app are.
 */

async function emailSupportAgents(subject: string, body: string): Promise<void> {
  const recipients = await pool.query<{ email: string }>(
    `SELECT DISTINCT u.email FROM volunteer_roles vr JOIN users u ON u.id = vr.user_id WHERE vr.role = 'SupportAgent'`,
  );
  for (const recipient of recipients.rows) {
    try {
      await sendEmail({ to: recipient.email, subject, body });
    } catch {
      // Isolates one bad recipient from blocking the rest — same reasoning
      // as src/lib/ops/payouts.ts's per-recipient email loop.
    }
  }
}

export interface CreateTicketState {
  error?: string;
}

export async function createTicketAction(
  _prevState: CreateTicketState,
  formData: FormData,
): Promise<CreateTicketState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/app/support");
  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || ctx.status !== "Active") redirect("/auth/login");

  const subject = String(formData.get("subject") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  if (!subject) return { error: "Enter a subject." };
  if (!message) return { error: "Enter a message." };

  const client = await pool.connect();
  let ticketId: string;
  try {
    await client.query("BEGIN");

    const ticketRow = await client.query<{ id: string }>(
      `INSERT INTO support_tickets (requester_user_id, subject, last_message_by_user_id)
       VALUES ($1, $2, $1) RETURNING id`,
      [ctx.id, subject],
    );
    ticketId = ticketRow.rows[0].id;

    await client.query(
      `INSERT INTO support_ticket_messages (ticket_id, author_user_id, content) VALUES ($1, $2, $3)`,
      [ticketId, ctx.id, message],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await emailSupportAgents(
    `New support ticket: ${subject}`,
    `${ctx.username} opened a new support ticket.\n\nSubject: ${subject}\n\n${message}`,
  );

  revalidatePath("/app/support");
  redirect(`/app/support/${ticketId}`);
}

export interface ReplyState {
  error?: string;
}

/**
 * Shared by both the requester (from /app/support/[id]) and staff
 * (/ops/support/[id]) — the caller must be either the ticket's own
 * requester, or hold VOL_SUPPORT/ADMIN, re-checked here regardless of which
 * page the request came from. A requester reply to a Resolved ticket
 * auto-reopens it; a staff reply never changes status on its own — staff
 * resolve explicitly via resolveTicketAction.
 */
export async function replyToTicketAction(_prevState: ReplyState, formData: FormData): Promise<ReplyState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login");
  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || ctx.status !== "Active") redirect("/auth/login");

  const ticketId = String(formData.get("ticketId") ?? "");
  const message = String(formData.get("message") ?? "").trim();
  if (!message) return { error: "Enter a message." };

  const isStaff = ctx.roles.includes("VOL_SUPPORT") || ctx.roles.includes("ADMIN");

  const client = await pool.connect();
  let requesterEmail = "";
  let requesterIsAuthor = false;
  let subject = "";
  try {
    await client.query("BEGIN");

    const ticketRow = await client.query<{ requester_user_id: string; status: string; subject: string }>(
      `SELECT requester_user_id, status, subject FROM support_tickets WHERE id = $1 FOR UPDATE`,
      [ticketId],
    );
    if (ticketRow.rowCount === 0) {
      await client.query("ROLLBACK");
      return { error: "Ticket not found." };
    }
    const ticket = ticketRow.rows[0];
    requesterIsAuthor = ticket.requester_user_id === ctx.id;
    subject = ticket.subject;
    if (!requesterIsAuthor && !isStaff) {
      await client.query("ROLLBACK");
      return { error: "Not authorized." };
    }

    await client.query(
      `INSERT INTO support_ticket_messages (ticket_id, author_user_id, content) VALUES ($1, $2, $3)`,
      [ticketId, ctx.id, message],
    );

    const reopens = requesterIsAuthor && ticket.status === "Resolved";
    await client.query(
      `UPDATE support_tickets SET last_message_at = now(), last_message_by_user_id = $1, status = $2 WHERE id = $3`,
      [ctx.id, reopens ? "Open" : ticket.status, ticketId],
    );

    const requesterRow = await client.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [
      ticket.requester_user_id,
    ]);
    requesterEmail = requesterRow.rows[0].email;

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (requesterIsAuthor) {
    await emailSupportAgents(
      `Support ticket reply: ${subject}`,
      `${ctx.username} replied to their support ticket.\n\nSubject: ${subject}\n\n${message}`,
    );
  } else {
    await writeAuditLog({
      actorId: ctx.id,
      actionType: "SUPPORT_TICKET_REPLY",
      metadata: { ticketId },
    });
    try {
      await sendEmail({
        to: requesterEmail,
        subject: `Reply to your support ticket: ${subject}`,
        body: `You have a new reply on your support ticket.\n\nSubject: ${subject}\n\n${message}`,
      });
    } catch {
      // best-effort, same isolation reasoning as emailSupportAgents
    }
  }

  revalidatePath(`/app/support/${ticketId}`);
  revalidatePath(`/ops/support/${ticketId}`);
  revalidatePath("/ops/support");
  return {};
}

async function setTicketStatus(formData: FormData, status: "Open" | "Resolved", actionType: string): Promise<void> {
  const ctx = await requireOpsRole(["VOL_SUPPORT"]);
  if (!ctx) return;

  const ticketId = String(formData.get("ticketId") ?? "");
  await pool.query(`UPDATE support_tickets SET status = $1 WHERE id = $2`, [status, ticketId]);
  await writeAuditLog({ actorId: ctx.id, actionType, metadata: { ticketId } });

  revalidatePath(`/ops/support/${ticketId}`);
  revalidatePath("/ops/support");
}

export async function resolveTicketAction(formData: FormData): Promise<void> {
  await setTicketStatus(formData, "Resolved", "SUPPORT_TICKET_RESOLVED");
}

export async function reopenTicketAction(formData: FormData): Promise<void> {
  await setTicketStatus(formData, "Open", "SUPPORT_TICKET_REOPENED");
}
