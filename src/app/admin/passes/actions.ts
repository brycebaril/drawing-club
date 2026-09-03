"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { writeAuditLog } from "@/lib/audit/log";
import { grantWeeklyVolunteerPasses } from "@/lib/ops/volunteerPasses";
import { currentWeekStart, toDateOnly } from "@/lib/sessions/shared";

export interface CreateBatchState {
  error?: string;
  success?: boolean;
  organizationName?: string;
  ownerUsername?: string;
}

/**
 * Every pass gets a real owner from the moment it's created — no claim
 * step. The admin picks one existing account (the institution's point of
 * contact) and all N passes land directly in that person's wallet as
 * 'Available'; they then share individual passes onward to their people
 * via the same mechanism any member uses (src/app/app/wallet/actions.ts's
 * sharePassAction).
 */
export async function createBatchAction(
  _prevState: CreateBatchState,
  formData: FormData,
): Promise<CreateBatchState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const organizationName = String(formData.get("organizationName") ?? "").trim();
  const ownerUserId = String(formData.get("ownerUserId") ?? "").trim();
  const quantity = Number(formData.get("quantity"));
  const effectivePrice = Number(formData.get("effectivePrice"));

  if (!organizationName) {
    return { error: "Organization name is required." };
  }
  if (!ownerUserId) {
    return { error: "Search for and select the batch owner." };
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    return { error: "Quantity must be a whole number between 1 and 100." };
  }
  if (!Number.isFinite(effectivePrice) || effectivePrice < 0) {
    return { error: "Effective price must be a non-negative number." };
  }

  const ownerRow = await pool.query<{ id: string; username: string }>(
    `SELECT id, username FROM users WHERE id = $1`,
    [ownerUserId],
  );
  if (ownerRow.rowCount === 0) {
    return { error: "That member couldn't be found." };
  }
  const ownerId = ownerRow.rows[0].id;
  const ownerUsername = ownerRow.rows[0].username;

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
      await client.query(
        `INSERT INTO passes (batch_id, owner_id, is_transferable, status, effective_price)
         VALUES ($1, $2, true, 'Available', $3)`,
        [batchId, ownerId, effectivePrice],
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
    targetUserId: ownerId,
    metadata: { batchId, organizationName, ownerUsername, quantity, effectivePrice },
  });

  revalidatePath("/admin/passes");
  return { success: true, organizationName, ownerUsername };
}

export interface GrantVolunteerPassesState {
  error?: string;
  granted?: number;
  skippedAtCap?: number;
  alreadyGranted?: number;
  weekStart?: string;
}

/**
 * Always targets the current week — no date picker, unlike
 * generateReportAction's, since there's no legitimate reason to backdate a
 * volunteer pass grant. Mirrors that action's shape otherwise.
 */
export async function grantVolunteerPassesAction(
  _prevState: GrantVolunteerPassesState,
  _formData: FormData,
): Promise<GrantVolunteerPassesState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const weekStart = currentWeekStart(new Date());
  const result = await grantWeeklyVolunteerPasses(weekStart);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "VOLUNTEER_PASSES_GRANTED",
    metadata: {
      weekStart: toDateOnly(weekStart),
      granted: result.granted.length,
      skippedAtCap: result.skippedAtCap.length,
      alreadyGranted: result.alreadyGranted.length,
    },
  });

  revalidatePath("/admin/passes");
  return {
    granted: result.granted.length,
    skippedAtCap: result.skippedAtCap.length,
    alreadyGranted: result.alreadyGranted.length,
    weekStart: toDateOnly(weekStart),
  };
}

export interface RevokeState {
  error?: string;
}

/**
 * Any unspent transferable pass, not just unclaimed inventory — under the
 * direct-ownership model every pass has an owner from creation, so
 * "unclaimed" isn't a concept revocation can scope to anymore. Still
 * admin-only, still reason-required and audit-logged.
 */
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
    `UPDATE passes SET status = 'Revoked'
     WHERE id = $1 AND is_transferable = true AND status IN ('Available', 'Assigned')`,
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
