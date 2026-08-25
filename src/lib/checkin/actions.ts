"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/lib/db/pool";
import { writeAuditLog } from "@/lib/audit/log";
import { requireCheckInAccess } from "./access";

export interface SetCheckedInResult {
  ok: boolean;
  error?: string;
}

/**
 * Called directly from SessionRosterCard's onClick (RPC-style, not a
 * <form action>) so the checkbox can update optimistically — matches
 * EditSessionModal's already-proven pattern for calling a Server Function
 * straight from a client event handler. Takes the target state explicitly
 * rather than toggling, so a client that already knows what it wants
 * (optimistic UI) can't land on the wrong state from two rapid clicks.
 */
export async function setCheckedInAction(
  sessionId: string,
  rowType: "pass" | "seat",
  rowId: string,
  checkedIn: boolean,
): Promise<SetCheckedInResult> {
  const ctx = await requireCheckInAccess(sessionId);
  if (!ctx) return { ok: false, error: "Not authorized." };

  if (rowType === "pass") {
    await pool.query(`UPDATE passes SET checked_in = $1 WHERE id = $2 AND session_id = $3`, [
      checkedIn,
      rowId,
      sessionId,
    ]);
  } else {
    await pool.query(`UPDATE seat_reservations SET checked_in = $1 WHERE id = $2 AND session_id = $3`, [
      checkedIn,
      rowId,
      sessionId,
    ]);
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "SESSION_CHECKED_IN",
    metadata: { sessionId, rowType, rowId, checkedIn },
  });

  revalidatePath(`/ops/check-in/${sessionId}`);
  revalidatePath("/ops/check-in");
  return { ok: true };
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
  if (!ctx) return { error: "Not authorized." };

  const content = String(formData.get("content") ?? "").trim();
  if (!content) {
    return { error: "Note can't be empty." };
  }

  await pool.query(`INSERT INTO session_notes (session_id, author_user_id, content) VALUES ($1, $2, $3)`, [
    sessionId,
    ctx.id,
    content,
  ]);

  revalidatePath(`/ops/check-in/${sessionId}`);
  revalidatePath("/ops/check-in");
  return {};
}
