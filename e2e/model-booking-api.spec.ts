import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { pool } from "./helpers";

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
