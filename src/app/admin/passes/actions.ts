"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { writeAuditLog } from "@/lib/audit/log";
import { generateClaimCode, hashClaimCode } from "@/lib/payments/claimCode";

/**
 * "Unredeemed" scopes to unclaimed inventory (owner_id NULL, still holding
 * its original claim code) — the exact shape a freshly batch-generated pass
 * has, mirroring sendGiftAction's own convention. A pass a member has
 * already claimed into their wallet is a different, still-unbuilt gap
 * (Phase 8's notes flag it for /admin/users/[id] specifically).
 */
const UNCLAIMED_INVENTORY_WHERE =
  "is_transferable = true AND owner_id IS NULL AND status = 'Assigned'";

export interface CreateBatchState {
  error?: string;
  codes?: string[];
  organizationName?: string;
}

/**
 * Mirrors sendGiftAction's pass-creation shape (owner_id NULL, status
 * 'Assigned', claim_code = hash) looped under one new pass_batches row
 * instead of taking an existing pass from a member's wallet. Returns the
 * raw codes directly via useActionState state rather than redirecting —
 * unlike sendGiftAction (which had to redirect-with-query-param because the
 * gifted pass's own row vanished from a list query, unmounting the form
 * before its one code could be read), this form isn't list-driven and N
 * codes can't fit in a URL anyway.
 */
export async function createBatchAction(
  _prevState: CreateBatchState,
  formData: FormData,
): Promise<CreateBatchState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const quantity = Number(formData.get("quantity"));
  const effectivePrice = Number(formData.get("effectivePrice"));

  if (!organizationName) {
    return { error: "Organization name is required." };
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    return { error: "Quantity must be a whole number between 1 and 100." };
  }
  if (!Number.isFinite(effectivePrice) || effectivePrice < 0) {
    return { error: "Effective price must be a non-negative number." };
  }

  const codes: string[] = [];
  const client = await pool.connect();
  let batchId: string;
  try {
    await client.query("BEGIN");

    const batchResult = await client.query<{ id: string }>(
      `INSERT INTO pass_batches (organization_name, quantity, created_by) VALUES ($1, $2, $3) RETURNING id`,
      [organizationName, quantity, ctx.id],
    );
    batchId = batchResult.rows[0].id;

    for (let i = 0; i < quantity; i++) {
      const code = generateClaimCode();
      codes.push(code);
      await client.query(
        `INSERT INTO passes (batch_id, is_transferable, status, claim_code, effective_price)
         VALUES ($1, true, 'Assigned', $2, $3)`,
        [batchId, hashClaimCode(code), effectivePrice],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "PASS_BATCH_CREATED",
    metadata: { batchId, organizationName, quantity, effectivePrice },
  });

  revalidatePath("/admin/passes");
  return { codes, organizationName };
}

export interface ReissueState {
  error?: string;
  newCode?: string;
}

export async function reissueClaimCodeAction(
  _prevState: ReissueState,
  formData: FormData,
): Promise<ReissueState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const passId = String(formData.get("passId") ?? "");
  const code = generateClaimCode();
  const codeHash = hashClaimCode(code);

  const updated = await pool.query(
    `UPDATE passes SET claim_code = $1 WHERE id = $2 AND ${UNCLAIMED_INVENTORY_WHERE}`,
    [codeHash, passId],
  );
  if (updated.rowCount === 0) {
    return { error: "That pass isn't eligible for a code reissue." };
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "PASS_CLAIM_CODE_REISSUED",
    metadata: { passId },
  });

  // No redirect — this row doesn't disappear from the list on reissue, so
  // the form stays mounted and the returned code stays visible naturally,
  // same reasoning as createBatchAction just without needing a workaround.
  revalidatePath("/admin/passes");
  return { newCode: code };
}

export interface RevokeState {
  error?: string;
}

export async function revokePassAction(
  _prevState: RevokeState,
  formData: FormData,
): Promise<RevokeState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const passId = String(formData.get("passId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { error: "A reason is required." };
  }

  const updated = await pool.query(
    `UPDATE passes SET status = 'Revoked' WHERE id = $1 AND ${UNCLAIMED_INVENTORY_WHERE}`,
    [passId],
  );
  if (updated.rowCount === 0) {
    return { error: "That pass isn't eligible for revocation." };
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "PASS_REVOKED",
    metadata: { passId, reason },
  });

  revalidatePath("/admin/passes");
  redirect("/admin/passes");
}
