"use server";

import { revalidatePath } from "next/cache";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { pool } from "@/lib/db/pool";
import { writeAuditLog } from "@/lib/audit/log";
import { sendEmail } from "@/lib/email/sender";

export interface AssignModelState {
  error?: string;
}

/**
 * Design Doc §11: model assignment is a Model Booker manually mirroring an
 * assignment already made in the separate legacy system — this just records
 * it and optionally notifies the host, it never contacts the model.
 */
export async function assignModelAction(
  _prevState: AssignModelState,
  formData: FormData,
): Promise<AssignModelState> {
  const ctx = await requireOpsRole(["VOL_MBR"]);
  if (!ctx) return { error: "Not authorized." };

  const sessionId = String(formData.get("sessionId") ?? "");
  const modelId = String(formData.get("modelId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!modelId) {
    return { error: "Choose a model." };
  }

  try {
    await pool.query(`INSERT INTO session_model_mapping (session_id, model_id) VALUES ($1, $2)`, [
      sessionId,
      modelId,
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "That model is already assigned to this session." };
    }
    throw error;
  }

  if (note) {
    await pool.query(
      `INSERT INTO session_notes (session_id, author_user_id, content) VALUES ($1, $2, $3)`,
      [sessionId, ctx.id, note],
    );
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "MODEL_ASSIGNMENT_RECORDED",
    metadata: { sessionId, modelId, note: note || null },
  });

  const hostRow = await pool.query<{ email: string; username: string }>(
    `SELECT u.email, u.username FROM sessions s JOIN users u ON u.id = s.host_user_id WHERE s.id = $1`,
    [sessionId],
  );
  if (hostRow.rowCount! > 0) {
    const modelRow = await pool.query<{ name: string }>(`SELECT name FROM models WHERE id = $1`, [modelId]);
    await sendEmail({
      to: hostRow.rows[0].email,
      subject: "Model assigned to your session",
      body: `Hi ${hostRow.rows[0].username},\n\n${modelRow.rows[0]?.name ?? "A model"} has been assigned to your upcoming session.${note ? `\n\nNote from the Model Booker: "${note}"` : ""}`,
    });
  }

  revalidatePath("/ops/model-booking");
  return {};
}

export async function unassignModelAction(formData: FormData): Promise<void> {
  const ctx = await requireOpsRole(["VOL_MBR"]);
  if (!ctx) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  const modelId = String(formData.get("modelId") ?? "");

  const deleted = await pool.query(
    `DELETE FROM session_model_mapping WHERE session_id = $1 AND model_id = $2`,
    [sessionId, modelId],
  );
  if (deleted.rowCount! > 0) {
    await writeAuditLog({
      actorId: ctx.id,
      actionType: "MODEL_ASSIGNMENT_REMOVED",
      metadata: { sessionId, modelId },
    });
  }

  revalidatePath("/ops/model-booking");
}

export async function setModelRequiredAction(formData: FormData): Promise<void> {
  const ctx = await requireOpsRole(["VOL_MBR"]);
  if (!ctx) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  const required = formData.get("required") === "true";

  await pool.query(`UPDATE sessions SET model_required = $1 WHERE id = $2`, [required, sessionId]);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "SESSION_MODEL_REQUIREMENT_UPDATED",
    metadata: { sessionId, modelRequired: required },
  });

  revalidatePath("/ops/model-booking");
}
