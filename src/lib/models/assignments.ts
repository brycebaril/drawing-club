import { pool } from "@/lib/db/pool";
import { writeAuditLog } from "@/lib/audit/log";
import { sendEmail } from "@/lib/email/sender";
import { auditActor, type ModelActor } from "./roster";

/**
 * Session <-> model assignment, shared by /ops/model-booking's Server Actions
 * and /api/model-booking/*. Both directions are idempotent: re-assigning an
 * existing pair or removing an absent one succeeds without side effects, so
 * the legacy tooling can safely retry.
 */

export type AssignResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: "session-not-found" | "model-not-found" | "model-retired" | "session-canceled" };

export async function assignModel(
  sessionId: string,
  modelId: string,
  actor: ModelActor,
  opts: { note?: string } = {},
): Promise<AssignResult> {
  const [session, model] = await Promise.all([
    pool.query<{ status: string }>(`SELECT status FROM sessions WHERE id = $1`, [sessionId]),
    pool.query<{ name: string; retired_at: Date | null }>(`SELECT name, retired_at FROM models WHERE id = $1`, [
      modelId,
    ]),
  ]);
  if (session.rowCount === 0) return { ok: false, reason: "session-not-found" };
  if (model.rowCount === 0) return { ok: false, reason: "model-not-found" };
  if (session.rows[0].status === "Canceled") return { ok: false, reason: "session-canceled" };
  if (model.rows[0].retired_at !== null) return { ok: false, reason: "model-retired" };

  // The Model Booker's optional note is also saved as a session note (UI
  // only — an API key has no user to author it), in the same transaction as
  // the mapping so the two become visible together.
  const note = opts.note?.trim() || null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO session_model_mapping (session_id, model_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [sessionId, modelId],
    );
    if (inserted.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: true, created: false };
    }
    if (note && actor.kind === "user") {
      await client.query(`INSERT INTO session_notes (session_id, author_user_id, content) VALUES ($1, $2, $3)`, [
        sessionId,
        actor.userId,
        note,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const { actorId, metadata } = auditActor(actor);
  await writeAuditLog({
    actorId,
    actionType: "MODEL_ASSIGNMENT_RECORDED",
    metadata: { ...metadata, sessionId, modelId, note },
  });

  const hostRow = await pool.query<{ email: string; username: string }>(
    `SELECT u.email, u.username FROM sessions s JOIN users u ON u.id = s.host_user_id WHERE s.id = $1`,
    [sessionId],
  );
  if (hostRow.rowCount! > 0) {
    await sendEmail({
      to: hostRow.rows[0].email,
      subject: "Model assigned to your session",
      body: `Hi ${hostRow.rows[0].username},\n\n${model.rows[0].name} has been assigned to your upcoming session.${note ? `\n\nNote from the Model Booker: "${note}"` : ""}`,
    });
  }

  return { ok: true, created: true };
}

export async function unassignModel(
  sessionId: string,
  modelId: string,
  actor: ModelActor,
): Promise<{ ok: true; removed: boolean } | { ok: false; reason: "session-not-found" | "model-not-found" }> {
  const [session, model] = await Promise.all([
    pool.query(`SELECT 1 FROM sessions WHERE id = $1`, [sessionId]),
    pool.query(`SELECT 1 FROM models WHERE id = $1`, [modelId]),
  ]);
  if (session.rowCount === 0) return { ok: false, reason: "session-not-found" };
  if (model.rowCount === 0) return { ok: false, reason: "model-not-found" };

  const deleted = await pool.query(`DELETE FROM session_model_mapping WHERE session_id = $1 AND model_id = $2`, [
    sessionId,
    modelId,
  ]);
  if (deleted.rowCount === 0) return { ok: true, removed: false };

  const { actorId, metadata } = auditActor(actor);
  await writeAuditLog({
    actorId,
    actionType: "MODEL_ASSIGNMENT_REMOVED",
    metadata: { ...metadata, sessionId, modelId },
  });
  return { ok: true, removed: true };
}
