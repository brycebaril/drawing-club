import { pool } from "@/lib/db/pool";
import { writeAuditLog } from "@/lib/audit/log";

/**
 * The model roster (docs/superpowers/specs/2026-11-10-model-booking-api-design.md):
 * this app's models table is the official roster, written both by
 * /ops/model-booking and by the legacy system's tooling over
 * /api/model-booking/*. Every roster mutation goes through here so the two
 * callers can't drift — a future /admin/models page should call these too.
 */

export type ModelActor =
  | { kind: "user"; userId: string }
  | { kind: "apiKey"; apiKeyId: string; apiKeyName: string };

export interface ModelRecord {
  id: string;
  legacyId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  retired: boolean;
  retiredAt: string | null;
}

export interface ModelInput {
  legacyId?: string | null;
  name?: string;
  email?: string | null;
  phone?: string | null;
  retired?: boolean;
}

interface ModelRow {
  id: string;
  legacy_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  retired_at: Date | null;
}

const MODEL_COLUMNS = "id, legacy_id, name, email, phone, retired_at";

// ModelInput field -> models column. Column names are fixed literals, never input.
const INFO_COLUMNS = { legacyId: "legacy_id", name: "name", email: "email", phone: "phone" } as const;

function toRecord(row: ModelRow): ModelRecord {
  return {
    id: row.id,
    legacyId: row.legacy_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    retired: row.retired_at !== null,
    retiredAt: row.retired_at ? new Date(row.retired_at).toISOString() : null,
  };
}

/** API-key mutations have no human actor: actor_id stays NULL, the key is named in metadata. */
export function auditActor(actor: ModelActor): { actorId?: string; metadata: Record<string, unknown> } {
  if (actor.kind === "user") return { actorId: actor.userId, metadata: {} };
  return { metadata: { via: "api", apiKeyId: actor.apiKeyId, apiKeyName: actor.apiKeyName } };
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === "23505";
}

export async function listModels(): Promise<ModelRecord[]> {
  const result = await pool.query<ModelRow>(`SELECT ${MODEL_COLUMNS} FROM models ORDER BY name`);
  return result.rows.map(toRecord);
}

export async function createModel(
  input: ModelInput & { name: string },
  actor: ModelActor,
): Promise<{ ok: true; model: ModelRecord } | { ok: false; reason: "duplicate-legacy-id" }> {
  let row: ModelRow;
  try {
    const result = await pool.query<ModelRow>(
      `INSERT INTO models (legacy_id, name, email, phone) VALUES ($1, $2, $3, $4) RETURNING ${MODEL_COLUMNS}`,
      [input.legacyId ?? null, input.name, input.email ?? null, input.phone ?? null],
    );
    row = result.rows[0];
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "duplicate-legacy-id" };
    throw error;
  }

  const { actorId, metadata } = auditActor(actor);
  await writeAuditLog({
    actorId,
    actionType: "MODEL_CREATED",
    metadata: { ...metadata, modelId: row.id, legacyId: row.legacy_id, name: row.name },
  });
  return { ok: true, model: toRecord(row) };
}

/**
 * Partial update: only fields present in `input` are written. A no-op input
 * returns the current model without an audit entry (same rule as
 * updateSettingAction — no audit trail for a change that didn't happen).
 */
export async function updateModel(
  id: string,
  input: ModelInput,
  actor: ModelActor,
): Promise<{ ok: true; model: ModelRecord } | { ok: false; reason: "not-found" | "duplicate-legacy-id" }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<ModelRow>(`SELECT ${MODEL_COLUMNS} FROM models WHERE id = $1 FOR UPDATE`, [
      id,
    ]);
    if (current.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not-found" };
    }
    const before = current.rows[0];

    const sets: string[] = [];
    const params: unknown[] = [];
    const changes: Record<string, [unknown, unknown]> = {};
    for (const field of Object.keys(INFO_COLUMNS) as (keyof typeof INFO_COLUMNS)[]) {
      const next = input[field];
      const column = INFO_COLUMNS[field];
      if (next === undefined || next === before[column]) continue;
      params.push(next);
      sets.push(`${column} = $${params.length}`);
      changes[field] = [before[column], next];
    }
    const wasRetired = before.retired_at !== null;
    const retiredChanged = input.retired !== undefined && input.retired !== wasRetired;
    if (retiredChanged) sets.push(`retired_at = ${input.retired ? "now()" : "NULL"}`);

    if (sets.length === 0) {
      await client.query("ROLLBACK");
      return { ok: true, model: toRecord(before) };
    }

    params.push(id);
    const updated = await client.query<ModelRow>(
      `UPDATE models SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING ${MODEL_COLUMNS}`,
      params,
    );

    const { actorId, metadata } = auditActor(actor);
    if (Object.keys(changes).length > 0) {
      await writeAuditLog(
        { actorId, actionType: "MODEL_UPDATED", metadata: { ...metadata, modelId: id, changes } },
        client,
      );
    }
    if (retiredChanged) {
      await writeAuditLog(
        { actorId, actionType: "MODEL_RETIRED", metadata: { ...metadata, modelId: id, retired: input.retired } },
        client,
      );
    }
    await client.query("COMMIT");
    return { ok: true, model: toRecord(updated.rows[0]) };
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(error)) return { ok: false, reason: "duplicate-legacy-id" };
    throw error;
  } finally {
    client.release();
  }
}
