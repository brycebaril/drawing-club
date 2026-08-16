"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import { getClientIp } from "@/lib/auth/clientIp";
import { isClaimRateLimited, recordClaimAttempt } from "@/lib/auth/rateLimit";
import { hashClaimCode } from "@/lib/payments/claimCode";
import { writeAuditLog } from "@/lib/audit/log";
import { pool } from "@/lib/db/pool";

export interface ClaimPassState {
  error?: string;
}

/**
 * Redeems a claim code (Design Doc §6.2, SiteOutline §3.2/§5.2). Rate-limited
 * per IP before anything else — SecurityDocument.md §2 treats a claim code
 * as "effectively a second credential surface." The pass row is locked and
 * its status/claimed_at re-checked inside the transaction (not just trusting
 * the page's earlier preview read), since the preview-then-confirm UI opens
 * a real window for the same code to be claimed twice in a race.
 */
export async function claimPassAction(
  _prevState: ClaimPassState,
  formData: FormData,
): Promise<ClaimPassState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/app/wallet/claim");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || ctx.status !== "Active") redirect("/auth/login");

  const code = String(formData.get("code") ?? "").trim();
  if (!code) {
    return { error: "Enter a claim code." };
  }

  const ip = getClientIp(await headers());
  if (await isClaimRateLimited(ip)) {
    return { error: "Too many attempts. Try again later." };
  }

  const codeHash = hashClaimCode(code);

  const client = await pool.connect();
  let claimedPassId: string | null = null;
  try {
    await client.query("BEGIN");

    const passRow = await client.query<{ id: string; status: string; claimed_at: Date | null }>(
      `SELECT id, status, claimed_at FROM passes WHERE claim_code = $1 FOR UPDATE`,
      [codeHash],
    );

    if (passRow.rowCount === 0 || passRow.rows[0].status !== "Assigned" || passRow.rows[0].claimed_at) {
      await client.query("ROLLBACK");
      await recordClaimAttempt(ip, false);
      return { error: "This claim link is invalid or has already been used." };
    }

    claimedPassId = passRow.rows[0].id;
    await client.query(
      `UPDATE passes SET owner_id = $1, claimed_at = now(), status = 'Available' WHERE id = $2`,
      [ctx.id, claimedPassId],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await recordClaimAttempt(ip, true);
  await writeAuditLog({
    actorId: ctx.id,
    actionType: "PASS_CLAIMED",
    metadata: { passId: claimedPassId },
  });

  revalidatePath("/app/wallet");
  redirect("/app/wallet?claimed=1");
}
