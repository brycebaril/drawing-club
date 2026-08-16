"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import { stripe } from "@/lib/stripe/client";
import { resolvePrice, isPurchasableItem, type PurchasableItem } from "@/lib/payments/pricing";
import { pool } from "@/lib/db/pool";
import { generateClaimCode, hashClaimCode } from "@/lib/payments/claimCode";
import { writeAuditLog } from "@/lib/audit/log";
import { sendEmail } from "@/lib/email/sender";

export interface CreateCheckoutSessionState {
  error?: string;
}

function describeItem(item: PurchasableItem): string {
  switch (item) {
    case "SinglePass":
      return "Single Session Pass";
    case "Pack5":
      return "5-Pass Pack";
    case "Pack10":
      return "10-Pass Pack";
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
    return { error: "Verify your email before buying a pass." };
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

export interface SendGiftState {
  error?: string;
}

/**
 * Gifts a transferable pass the caller already owns — this app has no "buy a
 * pass as a gift" checkout item (Design Doc §7.1 lists only SinglePass/
 * PassPack/MembershipRenewal), so gifting always re-assigns an existing pass
 * rather than creating one. Generates a claim code and moves the pass to the
 * transient "sent, not yet claimed" state (owner_id NULL, status Assigned)
 * rather than transferring ownership immediately — the recipient must
 * explicitly claim it at /app/wallet/claim.
 *
 * The raw code is only ever available right here, in this return value and
 * the outgoing email — passes.claim_code stores only its hash, so it can't
 * be re-shown later if the sender navigates away before copying the link.
 */
export async function sendGiftAction(
  _prevState: SendGiftState,
  formData: FormData,
): Promise<SendGiftState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/app/wallet");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || ctx.status !== "Active") redirect("/auth/login");
  if (!ctx.emailVerified) {
    return { error: "Verify your email before gifting a pass." };
  }

  const passId = String(formData.get("passId") ?? "");
  const recipientUsername = String(formData.get("recipientUsername") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  let recipientId: string | null = null;
  if (recipientUsername) {
    const recipientRow = await pool.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [
      recipientUsername,
    ]);
    if (recipientRow.rowCount === 0) {
      return { error: "No member found with that username." };
    }
    recipientId = recipientRow.rows[0].id;
    if (recipientId === ctx.id) {
      return { error: "You can't gift a pass to yourself." };
    }
  }

  const code = generateClaimCode();
  const codeHash = hashClaimCode(code);

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
      return { error: "Pass not found." };
    }
    if (!passRow.rows[0].is_transferable) {
      await client.query("ROLLBACK");
      return { error: "This pass isn't transferable." };
    }
    if (passRow.rows[0].status !== "Available") {
      await client.query("ROLLBACK");
      return { error: "This pass can't be gifted right now." };
    }

    await client.query(
      `UPDATE passes
       SET sender_user_id = $1, claim_code = $2, claim_note = $3, owner_id = NULL, status = 'Assigned'
       WHERE id = $4`,
      [ctx.id, codeHash, note || null, passId],
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
    actionType: "PASS_GIFT_SENT",
    targetUserId: recipientId ?? undefined,
    metadata: { passId, recipientUsername: recipientUsername || null },
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const claimLink = `${baseUrl}/app/wallet/claim?code=${code}`;

  if (recipientUsername) {
    const recipientEmailRow = await pool.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [
      recipientId,
    ]);
    await sendEmail({
      to: recipientEmailRow.rows[0].email,
      subject: `${ctx.username} sent you a session pass`,
      body: `Hi,\n\n${ctx.username} sent you a session pass${note ? ` with this note: "${note}"` : ""}.\n\nClaim it here:\n${claimLink}`,
    });
  }

  // Redirect with the code in the URL rather than returning it in the
  // action's state — the pass this form's row was rendered for moves out of
  // the "available transferable passes" query the instant this succeeds, so
  // that whole row (this form included) unmounts on the route refresh a
  // Server Action triggers; a message returned as local component state
  // would vanish before the sender ever saw it. Same "confirm via redirect
  // query param" pattern this page already uses for checkout=/claimed=.
  revalidatePath("/app/wallet");
  redirect(`/app/wallet?giftLink=${encodeURIComponent(claimLink)}`);
}

export interface RevokeGiftState {
  error?: string;
}

/**
 * Cancels an unclaimed gift and returns the pass to the sender's own wallet
 * — "cancel the transfer," not the admin-driven Revoked terminal status
 * (Design Doc §6.1's Revoked is about the org reclaiming value, e.g. after a
 * refund; a sender changing their mind before anything was spent is a
 * different scenario and shouldn't destroy a pass they already paid for).
 */
export async function revokeGiftAction(
  _prevState: RevokeGiftState,
  formData: FormData,
): Promise<RevokeGiftState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/app/wallet");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || ctx.status !== "Active") redirect("/auth/login");

  const passId = String(formData.get("passId") ?? "");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const passRow = await client.query<{
      sender_user_id: string | null;
      status: string;
      claimed_at: Date | null;
    }>(`SELECT sender_user_id, status, claimed_at FROM passes WHERE id = $1 FOR UPDATE`, [passId]);

    if (passRow.rowCount === 0 || passRow.rows[0].sender_user_id !== ctx.id) {
      await client.query("ROLLBACK");
      return { error: "Gift not found." };
    }
    if (passRow.rows[0].status !== "Assigned" || passRow.rows[0].claimed_at !== null) {
      await client.query("ROLLBACK");
      return { error: "This gift has already been claimed and can't be revoked." };
    }

    await client.query(
      `UPDATE passes
       SET owner_id = $1, sender_user_id = NULL, claim_code = NULL, claim_note = NULL, status = 'Available'
       WHERE id = $2`,
      [ctx.id, passId],
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
    actionType: "PASS_GIFT_REVOKED",
    metadata: { passId },
  });

  revalidatePath("/app/wallet");
  redirect("/app/wallet");
}
