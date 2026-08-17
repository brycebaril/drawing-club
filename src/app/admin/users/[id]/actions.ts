"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { writeAuditLog } from "@/lib/audit/log";
import { releaseAllFutureBookingsForUser } from "@/lib/booking/actions";

export interface ActionState {
  error?: string;
}

const STATUSES = ["Active", "Suspended", "Banned"] as const;
const VOLUNTEER_ROLES = ["SessionManager", "ContentEditor", "ModelBooker", "Controller"] as const;

/**
 * Every mutation here is reachable via a prefetched <Link> in SiteNav's
 * staff-nav (src/components/SiteNav.tsx), so without this, Next.js's client
 * Router Cache can serve the pre-mutation RSC payload for these paths after
 * the redirect below — the redirect lands on the right URL, but with stale data.
 */
function revalidateUserPages(userId: string) {
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
  revalidatePath("/admin/audit-logs");
}

export async function setAccountStatusAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const userId = String(formData.get("userId") ?? "");
  const newStatus = String(formData.get("status") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!(STATUSES as readonly string[]).includes(newStatus)) {
    return { error: "Choose a valid status." };
  }
  if (!reason) {
    return { error: "A reason is required." };
  }

  const userRow = await pool.query<{ status: string }>(`SELECT status FROM users WHERE id = $1`, [
    userId,
  ]);
  if (userRow.rowCount === 0) return { error: "User not found." };
  const previousStatus = userRow.rows[0].status;

  await pool.query(`UPDATE users SET status = $1 WHERE id = $2`, [newStatus, userId]);

  // Suspended and Banned both block all app access already (src/proxy.ts) —
  // either way the user can't attend, so free their upcoming seats for
  // someone who can (Phase 4 plan's decision, broader than SiteOutline's
  // literal "upon banning" wording).
  if (previousStatus !== newStatus && (newStatus === "Suspended" || newStatus === "Banned")) {
    await releaseAllFutureBookingsForUser(userId);
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "ACCOUNT_STATUS_CHANGED",
    targetUserId: userId,
    metadata: { previousStatus, newStatus, reason },
  });

  revalidateUserPages(userId);
  redirect(`/admin/users/${userId}`);
}

export async function grantPassAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const userId = String(formData.get("userId") ?? "");
  const quantity = Number(formData.get("quantity"));
  const isTransferable = formData.get("passType") === "Transferable";
  const reason = String(formData.get("reason") ?? "").trim();

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    return { error: "Quantity must be a whole number between 1 and 100." };
  }
  if (!reason) {
    return { error: "A reason is required (Design Doc §13's audit trail for manual grants)." };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < quantity; i++) {
      await client.query(
        `INSERT INTO passes (owner_id, status, is_transferable, effective_price)
         VALUES ($1, 'Available', $2, 0)`,
        [userId, isTransferable],
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
    actionType: "PASS_GRANTED",
    targetUserId: userId,
    metadata: { quantity, isTransferable, reason },
  });

  revalidateUserPages(userId);
  redirect(`/admin/users/${userId}`);
}

export async function adjustMembershipAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const userId = String(formData.get("userId") ?? "");
  const dateStr = String(formData.get("expiresAt") ?? "");
  const validUntil = new Date(`${dateStr}T23:59:59`);
  if (Number.isNaN(validUntil.getTime())) {
    return { error: "Enter a valid date." };
  }

  const userRow = await pool.query<{ membership_expires_at: Date | null }>(
    `SELECT membership_expires_at FROM users WHERE id = $1`,
    [userId],
  );
  if (userRow.rowCount === 0) return { error: "User not found." };
  const previousExpiresAt = userRow.rows[0].membership_expires_at;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Always append — Membership_History is a log of administrative
    // actions, not an editable record of "the current span" (Phase 4 plan).
    await client.query(
      `INSERT INTO membership_history (user_id, valid_from, valid_until, granted_by)
       VALUES ($1, now(), $2, $3)`,
      [userId, validUntil, ctx.id],
    );
    await client.query(`UPDATE users SET membership_expires_at = $1 WHERE id = $2`, [
      validUntil,
      userId,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "MEMBERSHIP_ADJUSTED",
    targetUserId: userId,
    metadata: { previousExpiresAt, newExpiresAt: validUntil },
  });

  revalidateUserPages(userId);
  redirect(`/admin/users/${userId}`);
}

export async function assignVolunteerRoleAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!(VOLUNTEER_ROLES as readonly string[]).includes(role)) {
    return { error: "Choose a valid role." };
  }

  try {
    await pool.query(
      `INSERT INTO volunteer_roles (user_id, role, assigned_by) VALUES ($1, $2, $3)`,
      [userId, role, ctx.id],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "This user already has that role." };
    }
    throw error;
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "VOLUNTEER_ROLE_ASSIGNED",
    targetUserId: userId,
    metadata: { role },
  });

  revalidateUserPages(userId);
  redirect(`/admin/users/${userId}`);
}

export async function removeVolunteerRoleAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) redirect("/auth/login");

  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");

  const deleted = await pool.query(`DELETE FROM volunteer_roles WHERE user_id = $1 AND role = $2`, [
    userId,
    role,
  ]);

  // Only log a real state change — a stale page or a double-submit hitting
  // a role that's already gone shouldn't add a false entry to the (append-
  // only, compliance-relevant) audit trail.
  if ((deleted.rowCount ?? 0) > 0) {
    await writeAuditLog({
      actorId: ctx.id,
      actionType: "VOLUNTEER_ROLE_REMOVED",
      targetUserId: userId,
      metadata: { role },
    });
  }

  revalidateUserPages(userId);
  redirect(`/admin/users/${userId}`);
}
