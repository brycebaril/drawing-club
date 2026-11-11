import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/lib/db/pool";

// The Model Booking API is built for retries: if the audit write fails after
// the change already committed, the caller gets a 500, retries, gets a no-op
// success, and the audit entry (plus the host email) is lost for good. So the
// audit write must share the change's transaction — a failed audit rolls the
// change back and the retry redoes all of it.
const auditState = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/audit/log", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/audit/log")>();
  return {
    ...original,
    writeAuditLog: vi.fn(async (...args: Parameters<typeof original.writeAuditLog>) => {
      if (auditState.fail) throw new Error("audit insert failed");
      return original.writeAuditLog(...args);
    }),
  };
});

const { assignModel, unassignModel } = await import("./assignments");
const { createModel } = await import("./roster");

const actor = { kind: "apiKey", apiKeyId: "test-key", apiKeyName: "audit atomicity test" } as const;
const created: { sessions: string[]; models: string[] } = { sessions: [], models: [] };

async function insertSession(): Promise<string> {
  const start = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO sessions (session_type, start_time, end_time, status, description)
     VALUES ('R', $1, $2, 'Canceled', 'vitest-audit-atomicity') RETURNING id`,
    [start, new Date(start.getTime() + 3 * 60 * 60 * 1000)],
  );
  created.sessions.push(result.rows[0].id);
  // Canceled so it never occupies a calendar slot; flipped to Scheduled for assignment.
  await pool.query(`UPDATE sessions SET status = 'Scheduled' WHERE id = $1`, [result.rows[0].id]);
  return result.rows[0].id;
}

async function insertModel(name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(`INSERT INTO models (name) VALUES ($1) RETURNING id`, [name]);
  created.models.push(result.rows[0].id);
  return result.rows[0].id;
}

async function mappingCount(sessionId: string, modelId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*) FROM session_model_mapping WHERE session_id = $1 AND model_id = $2`,
    [sessionId, modelId],
  );
  return Number(result.rows[0].count);
}

beforeEach(() => {
  auditState.fail = false;
});

afterAll(async () => {
  await pool.query(`DELETE FROM sessions WHERE id = ANY($1)`, [created.sessions]);
  await pool.query(`DELETE FROM models WHERE id = ANY($1)`, [created.models]);
  await pool.end();
});

describe("model mutations roll back when their audit entry can't be written", () => {
  it("assignModel leaves no mapping behind, so a retry reports created: true", async () => {
    const sessionId = await insertSession();
    const modelId = await insertModel(`vitest-audit-assign-${Date.now()}`);

    auditState.fail = true;
    await expect(assignModel(sessionId, modelId, actor)).rejects.toThrow("audit insert failed");
    expect(await mappingCount(sessionId, modelId)).toBe(0);

    auditState.fail = false;
    expect(await assignModel(sessionId, modelId, actor)).toEqual({ ok: true, created: true });
  });

  it("unassignModel keeps the mapping, so a retry reports removed: true", async () => {
    const sessionId = await insertSession();
    const modelId = await insertModel(`vitest-audit-unassign-${Date.now()}`);
    await assignModel(sessionId, modelId, actor);

    auditState.fail = true;
    await expect(unassignModel(sessionId, modelId, actor)).rejects.toThrow("audit insert failed");
    expect(await mappingCount(sessionId, modelId)).toBe(1);

    auditState.fail = false;
    expect(await unassignModel(sessionId, modelId, actor)).toEqual({ ok: true, removed: true });
  });

  it("createModel leaves no model row behind", async () => {
    const name = `vitest-audit-create-${Date.now()}`;
    auditState.fail = true;
    await expect(createModel({ name }, actor)).rejects.toThrow("audit insert failed");
    const rows = await pool.query(`SELECT 1 FROM models WHERE name = $1`, [name]);
    expect(rows.rowCount).toBe(0);
  });
});
