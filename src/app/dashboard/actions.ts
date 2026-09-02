"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pool } from "@/lib/db/pool";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { isValidEmail } from "@/lib/validation/email";
import { sendVerificationEmail } from "@/lib/email/verification";
import { disableMfa } from "@/lib/auth/mfaEnrollment";
import { getUserAuthContext } from "@/lib/auth/roles";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login");
  return session.user.id;
}

export interface ActionState {
  error?: string;
  success?: boolean;
}

// Same minimum as registration/reset-password (register/actions.ts, reset-password/actions.ts).
const MIN_PASSWORD_LENGTH = 8;
// Same shape as registration's own USERNAME_RE (register/actions.ts) — kept
// in sync deliberately, not imported, since that file's export is scoped to
// its own "use server" module (a "use server" file can only export async
// functions per CLAUDE.md's admin-reporting notes).
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

/**
 * Requires the current password before setting a new one — standard
 * account-recovery-adjacent hygiene (a stale/shared-device session
 * shouldn't be able to lock out the real owner without knowing it). No
 * audit log: routine member self-service, same precedent as booking/
 * cancelling (CLAUDE.md's Support tickets notes) — not staff/admin-observable.
 */
export async function changePasswordAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (newPassword !== confirmPassword) {
    return { error: "New passwords don't match." };
  }

  const userRow = await pool.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [
    userId,
  ]);
  if (userRow.rowCount === 0) return { error: "Account not found." };

  const currentOk = await verifyPassword(userRow.rows[0].password_hash, currentPassword);
  if (!currentOk) return { error: "Current password is incorrect." };

  const newHash = await hashPassword(newPassword);
  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, userId]);

  return { success: true };
}

/**
 * Display name + username in one form — both purely cosmetic identifiers,
 * unlike email (see updateEmailAction). Reuses register/actions.ts's exact
 * USERNAME_RE and case-sensitive uniqueness convention, not the legacy
 * migration script's RESERVED_USERNAMES list (that's a migration-only
 * concern — CLAUDE.md's Legacy Migration Scope notes).
 */
export async function updateProfileAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();

  const displayName = String(formData.get("displayName") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim();

  if (!displayName) return { error: "Enter your name." };
  if (!USERNAME_RE.test(username)) {
    return { error: "Username must be 3-32 characters: letters, numbers, underscores only." };
  }

  const existing = await pool.query(`SELECT id FROM users WHERE username = $1 AND id != $2`, [username, userId]);
  if ((existing.rowCount ?? 0) > 0) {
    return { error: "That username is already taken." };
  }

  try {
    await pool.query(`UPDATE users SET display_name = $1, username = $2 WHERE id = $3`, [
      displayName,
      username,
      userId,
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "That username is already taken." };
    }
    throw error;
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/**
 * Changing email is NOT purely cosmetic — email_verified_at gates booking/
 * purchasing app-wide (CLAUDE.md's core domain rules), so a changed email
 * must re-earn verification via the exact same mechanism registration uses
 * (createVerificationToken/sendVerificationEmail), not a new one.
 */
export async function updateEmailAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();

  const email = String(formData.get("email") ?? "").trim();
  if (!isValidEmail(email)) return { error: "Enter a valid email address." };

  const existing = await pool.query(`SELECT id FROM users WHERE lower(email) = lower($1) AND id != $2`, [
    email,
    userId,
  ]);
  if ((existing.rowCount ?? 0) > 0) {
    return { error: "That email is already in use." };
  }

  let user: { id: string; email: string; username: string };
  try {
    const result = await pool.query<{ id: string; email: string; username: string }>(
      `UPDATE users SET email = $1, email_verified_at = NULL WHERE id = $2 RETURNING id, email, username`,
      [email, userId],
    );
    user = result.rows[0];
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "That email is already in use." };
    }
    throw error;
  }

  await sendVerificationEmail(user);

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/**
 * Sets a flag for an admin to review and act on (Part D/E's design decision:
 * admin-reviewed, not immediate self-service anonymization) — see
 * anonymizeAccountAction (admin/users/[id]/actions.ts). Not audit-logged,
 * same self-service precedent as the rest of this file — the request itself
 * (visible on the member's own admin/users/[id] page) is the record.
 */
export async function requestCancellationAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Tell us why you're canceling." };

  await pool.query(
    `UPDATE users SET cancellation_requested_at = now(), cancellation_reason = $1 WHERE id = $2`,
    [reason, userId],
  );

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/**
 * Re-derives mfaRequired server-side rather than trusting anything from the
 * client — the UI already hides this button for a mfaRequired role, but
 * disableMfa() itself also refuses in that case (belt and suspenders, see
 * its own doc comment).
 */
export async function disableMfaAction(_prevState: ActionState, _formData: FormData): Promise<ActionState> {
  const userId = await requireUserId();
  const ctx = await getUserAuthContext(userId);
  if (!ctx) return { error: "Account not found." };

  const result = await disableMfa(userId, ctx.mfaRequired);
  if (!result.ok) return { error: result.error };

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

/** Lets a member change their mind before an admin has acted on the request. */
export async function withdrawCancellationRequestAction(): Promise<void> {
  const userId = await requireUserId();
  await pool.query(
    `UPDATE users SET cancellation_requested_at = NULL, cancellation_reason = NULL WHERE id = $1`,
    [userId],
  );
  revalidatePath("/dashboard");
  redirect("/dashboard");
}
