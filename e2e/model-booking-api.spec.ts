import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { findOpenSlotBase, pool, withSlotLock } from "./helpers";
import { addDays, startOfDay } from "@/lib/sessions/shared";

/** Inserts an API key directly (same hashing as src/lib/auth/apiKey.ts) and returns the raw value. */
async function createKey(scopes: string[]): Promise<{ raw: string; name: string }> {
  const raw = randomBytes(24).toString("base64url");
  const name = `e2e model booking ${Date.now()} ${Math.random().toString(36).slice(2, 8)}`;
  await pool.query(`INSERT INTO api_keys (name, key_hash, key_prefix, scopes) VALUES ($1, $2, $3, $4)`, [
    name,
    createHash("sha256").update(raw).digest("hex"),
    raw.slice(0, 12),
    scopes,
  ]);
  return { raw, name };
}

const auth = (raw: string) => ({ Authorization: `Bearer ${raw}` });

async function createModel(request: APIRequestContext, raw: string, body: Record<string, unknown>) {
  const response = await request.post("/api/model-booking/models", { headers: auth(raw), data: body });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; legacyId: string | null; name: string };
}

test("requests without a key get 401, keys without model_booking get 403", async ({ request }) => {
  expect((await request.get("/api/model-booking/models")).status()).toBe(401);
  const usersOnly = await createKey(["users"]);
  expect((await request.get("/api/model-booking/models", { headers: auth(usersOnly.raw) })).status()).toBe(403);
});

test("creates, lists, updates and retires a model, audit-logged against the key", async ({ request }) => {
  const key = await createKey(["model_booking"]);
  const created = await request.post("/api/model-booking/models", {
    headers: auth(key.raw),
    data: { legacyId: `e2e-${Date.now()}`, name: "E2E Model", email: "m@example.test", phone: "" },
  });
  expect(created.status()).toBe(201);
  const model = await created.json();
  expect(model.phone).toBeNull();
  expect(model.retired).toBe(false);

  const list = await (await request.get("/api/model-booking/models", { headers: auth(key.raw) })).json();
  expect(list.map((m: { id: string }) => m.id)).toContain(model.id);

  const updated = await request.patch(`/api/model-booking/models/${model.id}`, {
    headers: auth(key.raw),
    data: { email: "new@example.test" },
  });
  expect(updated.status()).toBe(200);
  expect((await updated.json()).email).toBe("new@example.test");

  const retired = await request.patch(`/api/model-booking/models/${model.id}`, {
    headers: auth(key.raw),
    data: { retired: true },
  });
  const retiredBody = await retired.json();
  expect(retiredBody.retired).toBe(true);
  expect(retiredBody.retiredAt).not.toBeNull();

  const audit = await pool.query<{ action_type: string; actor_id: string | null; key_name: string }>(
    `SELECT action_type, actor_id, metadata->>'apiKeyName' AS key_name FROM system_audit_logs
     WHERE metadata->>'modelId' = $1 ORDER BY created_at`,
    [model.id],
  );
  expect(audit.rows.map((r) => r.action_type)).toEqual(["MODEL_CREATED", "MODEL_UPDATED", "MODEL_RETIRED"]);
  for (const row of audit.rows) {
    expect(row.actor_id).toBeNull();
    expect(row.key_name).toBe(key.name);
  }
});

test("duplicate legacyId is a 409 on create and on update", async ({ request }) => {
  const key = await createKey(["model_booking"]);
  const legacyId = `e2e-dup-${Date.now()}`;
  await createModel(request, key.raw, { legacyId, name: "E2E Dup A" });

  const duplicate = await request.post("/api/model-booking/models", {
    headers: auth(key.raw),
    data: { legacyId, name: "E2E Dup B" },
  });
  expect(duplicate.status()).toBe(409);

  const other = await createModel(request, key.raw, { name: "E2E Dup C" });
  const patched = await request.patch(`/api/model-booking/models/${other.id}`, {
    headers: auth(key.raw),
    data: { legacyId },
  });
  expect(patched.status()).toBe(409);
});

test("bad ids and bad bodies are 404/400, never 500", async ({ request }) => {
  const key = await createKey(["model_booking"]);
  const notJson = await request.post("/api/model-booking/models", {
    headers: { ...auth(key.raw), "Content-Type": "application/json" },
    data: "not json",
  });
  expect(notJson.status()).toBe(400);
  expect(await notJson.json()).toHaveProperty("error");

  const tooLong = await request.post("/api/model-booking/models", {
    headers: auth(key.raw),
    data: { name: "x".repeat(300) },
  });
  expect(tooLong.status()).toBe(400);

  expect(
    (await request.patch("/api/model-booking/models/not-a-uuid", { headers: auth(key.raw), data: {} })).status(),
  ).toBe(404);
  expect(
    (await request.patch(`/api/model-booking/models/${randomUUID()}`, { headers: auth(key.raw), data: {} })).status(),
  ).toBe(404);
});

/**
 * Inserts a session at 10:00 org time. Scheduled ones take an open Morning day
 * 35-58 days out under the shared slot lock (same collision avoidance as every
 * other dated spec); a canceled one occupies no slot, so it needs no lock.
 */
async function insertSession(opts: { status?: "Scheduled" | "Canceled"; legacyId?: string; dayOffset?: number } = {}) {
  const insert = async (day: number) => {
    const start = new Date(addDays(startOfDay(new Date()), day).getTime() + 10 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
    const result = await pool.query<{ id: string }>(
      `INSERT INTO sessions (session_type, start_time, end_time, status, legacy_id, description)
       VALUES ('R', $1, $2, $3, $4, $5) RETURNING id`,
      [start, end, opts.status ?? "Scheduled", opts.legacyId ?? null, `e2e-model-booking-api-${Date.now()}`],
    );
    return result.rows[0].id;
  };
  if (opts.status === "Canceled") return insert(opts.dayOffset ?? 45);
  return withSlotLock("Morning", async () => insert(await findOpenSlotBase(new Date(), "Morning", [0], 35, 58)));
}

interface FeedSession {
  id: string;
  legacyId: string | null;
  status: string;
  models: { id: string }[];
}

async function feedSession(request: APIRequestContext, raw: string, sessionId: string, query = "?days=120") {
  const response = await request.get(`/api/model-booking/sessions${query}`, { headers: auth(raw) });
  expect(response.status()).toBe(200);
  return ((await response.json()) as FeedSession[]).find((s) => s.id === sessionId);
}

const assignmentUrl = (sessionId: string, modelId: string) =>
  `/api/model-booking/sessions/${sessionId}/models/${modelId}`;

test("assign is idempotent, supports several models, and unassign is idempotent", async ({ request }) => {
  const key = await createKey(["model_booking"]);
  const sessionId = await insertSession();
  const m1 = await createModel(request, key.raw, { name: "E2E Assign One" });
  const m2 = await createModel(request, key.raw, { name: "E2E Assign Two" });

  const first = await request.put(assignmentUrl(sessionId, m1.id), { headers: auth(key.raw) });
  expect(first.status()).toBe(200);
  expect((await first.json()).created).toBe(true);
  const again = await request.put(assignmentUrl(sessionId, m1.id), { headers: auth(key.raw) });
  expect(again.status()).toBe(200);
  expect((await again.json()).created).toBe(false);
  expect((await request.put(assignmentUrl(sessionId, m2.id), { headers: auth(key.raw) })).status()).toBe(200);

  const both = await feedSession(request, key.raw, sessionId);
  expect(both!.models.map((m) => m.id).sort()).toEqual([m1.id, m2.id].sort());

  expect((await request.delete(assignmentUrl(sessionId, m1.id), { headers: auth(key.raw) })).status()).toBe(204);
  expect((await request.delete(assignmentUrl(sessionId, m1.id), { headers: auth(key.raw) })).status()).toBe(204);
  const remaining = await feedSession(request, key.raw, sessionId);
  expect(remaining!.models.map((m) => m.id)).toEqual([m2.id]);

  const recorded = await pool.query<{ count: string }>(
    `SELECT count(*) FROM system_audit_logs WHERE action_type = 'MODEL_ASSIGNMENT_RECORDED'
     AND metadata->>'sessionId' = $1 AND metadata->>'modelId' = $2`,
    [sessionId, m1.id],
  );
  expect(Number(recorded.rows[0].count)).toBe(1);
});

test("retired models and canceled sessions can't be assigned; retiring keeps existing assignments", async ({
  request,
}) => {
  const key = await createKey(["model_booking"]);
  const sessionId = await insertSession();
  const otherSessionId = await insertSession();
  const canceledId = await insertSession({ status: "Canceled" });
  const model = await createModel(request, key.raw, { name: "E2E Retiring Model" });
  const active = await createModel(request, key.raw, { name: "E2E Still Active Model" });

  expect((await request.put(assignmentUrl(sessionId, model.id), { headers: auth(key.raw) })).status()).toBe(200);
  await request.patch(`/api/model-booking/models/${model.id}`, { headers: auth(key.raw), data: { retired: true } });

  const stillAssigned = await feedSession(request, key.raw, sessionId);
  expect(stillAssigned!.models.map((m) => m.id)).toEqual([model.id]);

  expect((await request.put(assignmentUrl(otherSessionId, model.id), { headers: auth(key.raw) })).status()).toBe(409);
  expect((await request.put(assignmentUrl(canceledId, active.id), { headers: auth(key.raw) })).status()).toBe(409);
  expect((await request.delete(assignmentUrl(sessionId, model.id), { headers: auth(key.raw) })).status()).toBe(204);
});

test("feed includes canceled sessions with legacyId and honours days", async ({ request }) => {
  const key = await createKey(["model_booking"]);
  const legacyId = `e2e-${Date.now()}`;
  const canceledId = await insertSession({ status: "Canceled", legacyId, dayOffset: 45 });

  const inDefault = await feedSession(request, key.raw, canceledId, "");
  expect(inDefault).toMatchObject({ status: "Canceled", legacyId });
  expect(await feedSession(request, key.raw, canceledId, "?days=30")).toBeUndefined();

  for (const days of ["0", "121", "abc"]) {
    const response = await request.get(`/api/model-booking/sessions?days=${days}`, { headers: auth(key.raw) });
    expect(response.status()).toBe(400);
  }
});

test("bad session/model ids are 404", async ({ request }) => {
  const key = await createKey(["model_booking"]);
  const sessionId = await insertSession({ status: "Canceled", dayOffset: 50 });
  const model = await createModel(request, key.raw, { name: "E2E 404 Model" });

  // Asserting the JSON error body, not just the status — a missing route also 404s (as an HTML page).
  for (const response of [
    await request.put(assignmentUrl("not-a-uuid", model.id), { headers: auth(key.raw) }),
    await request.put(assignmentUrl(randomUUID(), model.id), { headers: auth(key.raw) }),
    await request.delete(assignmentUrl(sessionId, randomUUID()), { headers: auth(key.raw) }),
  ]) {
    expect(response.status()).toBe(404);
    expect(await response.json()).toHaveProperty("error");
  }
});
