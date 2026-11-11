"use server";

import { revalidatePath } from "next/cache";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { pool } from "@/lib/db/pool";
import { writeAuditLog } from "@/lib/audit/log";
import { assignModel, unassignModel, type AssignResult } from "@/lib/models/assignments";

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

  const result = await assignModel(sessionId, modelId, { kind: "user", userId: ctx.id }, { note });
  if (!result.ok) {
    return { error: ASSIGN_ERRORS[result.reason] };
  }
  if (!result.created) {
    return { error: "That model is already assigned to this session." };
  }

  revalidatePath("/ops/model-booking");
  return {};
}

const ASSIGN_ERRORS: Record<Extract<AssignResult, { ok: false }>["reason"], string> = {
  "model-retired": "That model is retired.",
  "session-canceled": "That session is canceled.",
  "session-not-found": "Session or model not found.",
  "model-not-found": "Session or model not found.",
};

export async function unassignModelAction(formData: FormData): Promise<void> {
  const ctx = await requireOpsRole(["VOL_MBR"]);
  if (!ctx) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  const modelId = String(formData.get("modelId") ?? "");
  await unassignModel(sessionId, modelId, { kind: "user", userId: ctx.id });

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
