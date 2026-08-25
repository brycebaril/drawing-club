"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import { stripe } from "@/lib/stripe/client";
import { resolvePrice, isPurchasableItem, type PurchasableItem } from "@/lib/payments/pricing";
import { pool } from "@/lib/db/pool";
import { writeAuditLog } from "@/lib/audit/log";
import { sendEmail } from "@/lib/email/sender";

export interface CreateCheckoutSessionState {
  error?: string;
}

function describeItem(item: PurchasableItem): string {
  switch (item) {
    case "SinglePass":
      return "Single Session Ticket";
    case "Pack5":
      return "5-Ticket Pack";
    case "Pack10":
      return "10-Ticket Pack";
    case "MembershipRenewal":
      return "Annual Membership Renewal";
  }
}

/**
 * Creates a Stripe Checkout Session and redirects the browser to it
 * (Design Doc §7, ArchitectureDocument.md §7). Price is resolved entirely
 * server-side from the viewer's current membership status and the
 * system_settings store — the client only ever picks *which* item, never
 * how much it costs. Fulfillment (creating passes / extending membership)
 * happens later, in src/app/api/webhooks/stripe/route.ts, once Stripe
 * confirms the charge — not here, since the user hasn't paid yet at the
 * point this action runs.
 */
export async function createCheckoutSessionAction(
  _prevState: CreateCheckoutSessionState,
  formData: FormData,
): Promise<CreateCheckoutSessionState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/app/wallet");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || ctx.status !== "Active") redirect("/auth/login");
  if (!ctx.emailVerified) {
    return { error: "Verify your email before buying a ticket." };
  }

  const item = String(formData.get("item") ?? "");
  if (!isPurchasableItem(item)) {
    return { error: "Choose something to buy." };
  }

  const isMember = ctx.roles.includes("MBR");
  const resolved = await resolvePrice(item, isMember).catch(() => null);
  if (!resolved) {
    return { error: "That item isn't available to you." };
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: describeItem(item) },
          unit_amount: Math.round(resolved.totalPrice * 100),
        },
        quantity: 1,
      },
    ],
    client_reference_id: ctx.id,
    metadata: {
      userId: ctx.id,
      item,
      passCount: String(resolved.passCount),
      effectivePricePerPass:
        resolved.effectivePricePerPass !== null ? String(resolved.effectivePricePerPass) : "",
    },
    success_url: `${baseUrl}/app/wallet?checkout=success`,
    cancel_url: `${baseUrl}/app/wallet?checkout=cancelled`,
  });

  if (!checkoutSession.url) {
    return { error: "Could not start checkout. Try again." };
  }

  redirect(checkoutSession.url);
}

export interface SharePassState {
  error?: string;
}

/**
 * Shares a transferable pass the caller already owns with a specific,
 * named member. Unlike the claim-code mechanism this replaces, owner_id
 * never goes null — the pass stays owned by the sender (locked at status
 * 'Assigned', same as before, so it can't be double-spent while pending)
 * until the recipient explicitly accepts or declines from their own
 * /app/wallet. No code, no link — the recipient is identified by their
 * account directly.
 */
export async function sharePassAction(
  _prevState: SharePassState,
  formData: FormData,
): Promise<SharePassState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/app/wallet");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || ctx.status !== "Active") redirect("/auth/login");
  if (!ctx.emailVerified) {
    return { error: "Verify your email before sharing a ticket." };
  }

  const passId = String(formData.get("passId") ?? "");
  const recipientUsername = String(formData.get("recipientUsername") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!recipientUsername) {
    return { error: "Enter the username of who you want to share this ticket with." };
  }

  const recipientRow = await pool.query<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE username = $1`,
    [recipientUsername],
  );
  if (recipientRow.rowCount === 0) {
    return { error: "No member found with that username." };
  }
  const recipient = recipientRow.rows[0];
  if (recipient.id === ctx.id) {
    return { error: "You can't share a ticket with yourself." };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const passRow = await client.query<{
      owner_id: string | null;
      status: string;
      is_transferable: boolean;
    }>(`SELECT owner_id, status, is_transferable FROM passes WHERE id = $1 FOR UPDATE`, [passId]);

    if (passRow.rowCount === 0 || passRow.rows[0].owner_id !== ctx.id) {
      await client.query("ROLLBACK");
      return { error: "Ticket not found." };
    }
    if (!passRow.rows[0].is_transferable) {
      await client.query("ROLLBACK");
      return { error: "This ticket isn't transferable." };
    }
    if (passRow.rows[0].status !== "Available") {
      await client.query("ROLLBACK");
      return { error: "This ticket can't be shared right now." };
    }

    await client.query(
      `UPDATE passes
       SET sender_user_id = $1, pending_recipient_id = $2, share_note = $3, status = 'Assigned'
       WHERE id = $4`,
      [ctx.id, recipient.id, note || null, passId],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "PASS_SHARE_SENT",
    targetUserId: recipient.id,
    metadata: { passId, recipientUsername },
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  await sendEmail({
    to: recipient.email,
    subject: `${ctx.username} wants to share a session ticket with you`,
    body: `Hi,\n\n${ctx.username} wants to share a session ticket with you${note ? ` with this note: "${note}"` : ""}.\n\nLog in to accept or decline:\n${baseUrl}/app/wallet`,
  });

  revalidatePath("/app/wallet");
  redirect("/app/wallet");
}

export interface TransferActionState {
  error?: string;
}

/** Recipient accepts a pending transfer — ownership moves to them, same "claimed passes go straight to Available" precedent as before. */
export async function acceptTransferAction(
  _prevState: TransferActionState,
  formData: FormData,
): Promise<TransferActionState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/app/wallet");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || ctx.status !== "Active") redirect("/auth/login");

  const passId = String(formData.get("passId") ?? "");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const passRow = await client.query<{ pending_recipient_id: string | null; status: string }>(
      `SELECT pending_recipient_id, status FROM passes WHERE id = $1 FOR UPDATE`,
      [passId],
    );

    if (
      passRow.rowCount === 0 ||
      passRow.rows[0].pending_recipient_id !== ctx.id ||
      passRow.rows[0].status !== "Assigned"
    ) {
      await client.query("ROLLBACK");
      return { error: "This transfer isn't available." };
    }

    await client.query(
      `UPDATE passes SET owner_id = $1, pending_recipient_id = NULL, status = 'Available' WHERE id = $2`,
      [ctx.id, passId],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await writeAuditLog({ actorId: ctx.id, actionType: "PASS_SHARE_ACCEPTED", metadata: { passId } });

  revalidatePath("/app/wallet");
  redirect("/app/wallet");
}

/** Recipient declines — pass returns to the sender's own wallet, same end-state as a sender-initiated cancel. */
export async function declineTransferAction(
  _prevState: TransferActionState,
  formData: FormData,
): Promise<TransferActionState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/app/wallet");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || ctx.status !== "Active") redirect("/auth/login");

  const passId = String(formData.get("passId") ?? "");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const passRow = await client.query<{ pending_recipient_id: string | null }>(
      `SELECT pending_recipient_id FROM passes WHERE id = $1 FOR UPDATE`,
      [passId],
    );

    if (passRow.rowCount === 0 || passRow.rows[0].pending_recipient_id !== ctx.id) {
      await client.query("ROLLBACK");
      return { error: "This transfer isn't available." };
    }

    await client.query(
      `UPDATE passes SET pending_recipient_id = NULL, sender_user_id = NULL, status = 'Available' WHERE id = $1`,
      [passId],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await writeAuditLog({ actorId: ctx.id, actionType: "PASS_SHARE_DECLINED", metadata: { passId } });

  revalidatePath("/app/wallet");
  redirect("/app/wallet");
}

/**
 * Sender cancels a pending share before the recipient has responded —
 * "cancel the transfer," not the admin-driven Revoked terminal status
 * (Design Doc §6.1's Revoked is about the org reclaiming value, e.g. after a
 * refund; a sender changing their mind before anything was spent is a
 * different scenario and shouldn't destroy a pass they already paid for).
 */
export async function cancelTransferAction(
  _prevState: TransferActionState,
  formData: FormData,
): Promise<TransferActionState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/app/wallet");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || ctx.status !== "Active") redirect("/auth/login");

  const passId = String(formData.get("passId") ?? "");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const passRow = await client.query<{ owner_id: string | null; pending_recipient_id: string | null }>(
      `SELECT owner_id, pending_recipient_id FROM passes WHERE id = $1 FOR UPDATE`,
      [passId],
    );

    if (
      passRow.rowCount === 0 ||
      passRow.rows[0].owner_id !== ctx.id ||
      !passRow.rows[0].pending_recipient_id
    ) {
      await client.query("ROLLBACK");
      return { error: "This pending share isn't available." };
    }

    await client.query(
      `UPDATE passes SET pending_recipient_id = NULL, sender_user_id = NULL, status = 'Available' WHERE id = $1`,
      [passId],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await writeAuditLog({ actorId: ctx.id, actionType: "PASS_SHARE_CANCELLED", metadata: { passId } });

  revalidatePath("/app/wallet");
  redirect("/app/wallet");
}
