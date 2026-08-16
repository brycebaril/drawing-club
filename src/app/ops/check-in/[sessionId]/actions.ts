"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { pool } from "@/lib/db/pool";
import { writeAuditLog } from "@/lib/audit/log";

/**
 * SecurityDocument.md §3: the RBAC matrix is route-level only — VOL_HOST is
 * additionally scoped to sessions they're assigned to host, which Proxy
 * can't express, so every mutation in this file re-derives and re-checks it
 * server-side rather than trusting the page already did.
 */
async function requireCheckInAccess(sessionId: string) {
  const ctx = await requireOpsRole(["VOL_HOST", "VOL_MBR"]);
  if (!ctx) notFound();

  const sessionRow = await pool.query<{ host_user_id: string | null }>(
    `SELECT host_user_id FROM sessions WHERE id = $1`,
    [sessionId],
  );
  if (sessionRow.rowCount === 0) notFound();

  const isPrivileged = ctx.roles.includes("ADMIN") || ctx.roles.includes("VOL_MBR");
  const isAssignedHost = ctx.roles.includes("VOL_HOST") && sessionRow.rows[0].host_user_id === ctx.id;
  if (!isPrivileged && !isAssignedHost) notFound();

  return ctx;
}

export async function toggleCheckedInAction(formData: FormData): Promise<void> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const ctx = await requireCheckInAccess(sessionId);

  const rowType = String(formData.get("rowType") ?? "");
  const rowId = String(formData.get("rowId") ?? "");

  if (rowType === "pass") {
    await pool.query(
      `UPDATE passes SET checked_in = NOT checked_in WHERE id = $1 AND session_id = $2`,
      [rowId, sessionId],
    );
  } else if (rowType === "seat") {
    await pool.query(
      `UPDATE seat_reservations SET checked_in = NOT checked_in WHERE id = $1 AND session_id = $2`,
      [rowId, sessionId],
    );
  } else {
    return;
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "SESSION_CHECKED_IN",
    metadata: { sessionId, rowType, rowId },
  });

  revalidatePath(`/ops/check-in/${sessionId}`);
  redirect(`/ops/check-in/${sessionId}`);
}

export interface PostNoteState {
  error?: string;
}

export async function postSessionNoteAction(
  _prevState: PostNoteState,
  formData: FormData,
): Promise<PostNoteState> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const ctx = await requireCheckInAccess(sessionId);

  const content = String(formData.get("content") ?? "").trim();
  if (!content) {
    return { error: "Note can't be empty." };
  }

  await pool.query(
    `INSERT INTO session_notes (session_id, author_user_id, content) VALUES ($1, $2, $3)`,
    [sessionId, ctx.id, content],
  );

  revalidatePath(`/ops/check-in/${sessionId}`);
  redirect(`/ops/check-in/${sessionId}`);
}
