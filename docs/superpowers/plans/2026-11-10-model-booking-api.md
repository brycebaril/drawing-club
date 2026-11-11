# Model Booking API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Bearer-key JSON API under `/api/model-booking/` that lets the legacy system's tooling read the upcoming-session feed and manage the model roster and per-session model assignments, with this app's `models` table as the official roster.

**Architecture:** One migration adds `models.email/phone/retired_at` (replacing `contact_info`) and `sessions.legacy_id`. All roster/assignment mutations move into `src/lib/models/*`, called by both `/ops/model-booking`'s Server Actions and thin route handlers. Route auth reuses `requireApiKeyScope` with a new `model_booking` scope.

**Tech Stack:** Next.js 16 App Router route handlers (dynamic `params` is a `Promise`), raw `pg`, node-pg-migrate, Vitest (pure helpers), Playwright `request` (e2e).

**Spec:** `docs/superpowers/specs/2026-11-10-model-booking-api-design.md`

## Global Constraints

- Base path `/api/model-booking/`; auth `Authorization: Bearer <key>`; scope literal `"model_booking"`.
- JSON in/out. Timestamps ISO 8601 UTC (`Date#toISOString()`). Every error body is `{ "error": "<message>" }`.
- `GET /sessions` window: `start_time` in `[now(), now() + days]`, `days` default **60**, max **120**, includes `Canceled` sessions.
- Audit action types, exact: `MODEL_CREATED`, `MODEL_UPDATED`, `MODEL_RETIRED` (metadata `{retired: boolean}`, both directions), and the existing `MODEL_ASSIGNMENT_RECORDED` / `MODEL_ASSIGNMENT_REMOVED`.
- API-originated audit entries: `actorId` omitted (NULL), metadata includes `{ via: "api", apiKeyId, apiKeyName }`.
- Every roster/assignment mutation goes through `src/lib/models/*` — no route handler or Server Action writes `models`/`session_model_mapping` directly.
- New migration only; never edit an existing migration file (CLAUDE.md convention).
- Field length cap 255 (`varchar(255)`) for `name`, `email`, `phone`, `legacyId`.
- No credentials (staging DB password, API keys) in any committed file, doc, or transcript.

## Review Focus

1. **Malformed UUID in a path** (`/models/abc`, `/sessions/abc/models/…`) → expect 404 JSON, not a 500 from Postgres `22P02`. Test in Task 4 and Task 5.
2. **Malformed body** (non-JSON, array, `name: 42`, `retired: "yes"`, a 300-char name) → expect 400 JSON, not a 500 from `JSON.parse` or Postgres `22001`. Unit-tested in Task 3, one e2e in Task 4.
3. **`days` out of range or non-numeric** (`0`, `121`, `abc`, `-5`) → expect 400, not a silently clamped or empty feed. Unit-tested in Task 3, e2e in Task 5.
4. **PATCH changing `legacyId` to one another model already has** → expect 409, not a 500 from the unique index. Test in Task 4.
5. **Retiring a model that has upcoming assignments** → expect the assignments to stay (he replaces explicitly) and DELETE to still work for that retired model. Test in Task 5.

---

### Task 1: Schema migration and `contact_info` → `email`/`phone`

**Files:**
- Create: `migrations/<timestamp>_model-booking-api.js` (via `pnpm migrate:create model-booking-api`)
- Modify: `src/lib/ops/payouts.ts:79` (SQL only), `src/app/ops/financials/csv/route.ts:45`
- Modify: `scripts/seed.ts:49-55`, `scripts/legacy-migration/models.ts:49-55`, `scripts/legacy-migration/sessions.ts:258-262`
- Modify: `e2e/ops-model-booking.spec.ts:11`, `e2e/ops-checkin.spec.ts:181,185`, `e2e/ops-financials.spec.ts:26`

**Interfaces:**
- Produces: `models(id, legacy_id, name, email, phone, retired_at)` with partial unique index `models_legacy_id_unique ON models(legacy_id) WHERE legacy_id IS NOT NULL`; `sessions.legacy_id varchar(255)` nullable.

- [ ] **Step 1: Create the migration file** — `pnpm migrate:create model-booking-api`. Header comment cites the spec path.

- [ ] **Step 2: Write `up`**, in this order:
  1. `addColumns("models", { email: varchar(255), phone: varchar(255), retired_at: timestamptz })`
  2. `pgm.sql("UPDATE models SET email = NULLIF(split_part(contact_info, ' / ', 1), ''), phone = NULLIF(split_part(contact_info, ' / ', 2), '')")`
  3. `dropColumn("models", "contact_info")`
  4. `createIndex("models", "legacy_id", { name: "models_legacy_id_unique", unique: true, where: "legacy_id IS NOT NULL" })`
  5. `addColumn("sessions", { legacy_id: varchar(255) })`

  `down` reverses: drop `sessions.legacy_id`, drop the index, add `contact_info varchar(255)`, `UPDATE models SET contact_info = NULLIF(concat_ws(' / ', email, phone), '')`, drop `email`/`phone`/`retired_at`.

- [ ] **Step 3: Run it against local dev and check the backfill on real migrated data**

  Run: `pnpm migrate`, then
  `psql "$DATABASE_URL" -c "SELECT count(*) FILTER (WHERE email IS NULL) AS no_email, count(*) FILTER (WHERE phone IS NOT NULL) AS with_phone, count(*) AS total FROM models"`
  Expected: `no_email = 0`, `with_phone > 0`. Then `pnpm migrate:down && pnpm migrate` succeeds (round-trip).

- [ ] **Step 4: Switch readers** — `payouts.ts` selects `concat_ws(' / ', m.email, m.phone) AS model_contact_info` (TS field `modelContactInfo` unchanged, so `payouts.test.ts` needs no edit); the CSV route selects `concat_ws(' / ', m.email, m.phone) AS contact_info`.

- [ ] **Step 5: Switch writers** — `seed.ts`'s `upsertModel(name, email)` inserts `email`; legacy `models.ts` inserts `(legacy_id, name, email, phone)` with `row.EMail.trim()` and `row.Phone?.trim() || null`; legacy `sessions.ts` adds `legacy_id` = `String(row.id)` to the `INSERT INTO sessions`. The three e2e specs insert `email` instead of `contact_info`.

- [ ] **Step 6: Verify**

  Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e e2e/ops-financials.spec.ts e2e/ops-checkin.spec.ts e2e/ops-model-booking.spec.ts`
  Expected: all pass.

- [ ] **Step 7: Commit** — `git add migrations/ src/lib/ops/payouts.ts src/app/ops/financials/csv/route.ts scripts/ e2e/ && git commit -m "Split models.contact_info into email/phone, add retired_at and sessions.legacy_id"`

---

### Task 2: Shared roster/assignment lib + `/ops/model-booking` on top of it

**Files:**
- Create: `src/lib/models/roster.ts`, `src/lib/models/assignments.ts`
- Modify: `src/app/ops/model-booking/actions.ts`, `src/app/ops/model-booking/page.tsx:55`
- Test: `e2e/ops-model-booking.spec.ts`

**Interfaces:**
- Consumes: Task 1 schema; `writeAuditLog` (`src/lib/audit/log.ts`); `sendEmail`.
- Produces (`roster.ts`):
  ```ts
  export type ModelActor =
    | { kind: "user"; userId: string }
    | { kind: "apiKey"; apiKeyId: string; apiKeyName: string };
  export interface ModelRecord {
    id: string; legacyId: string | null; name: string;
    email: string | null; phone: string | null;
    retired: boolean; retiredAt: string | null; // ISO
  }
  export interface ModelInput {
    legacyId?: string | null; name?: string;
    email?: string | null; phone?: string | null; retired?: boolean;
  }
  export function auditActor(actor: ModelActor): { actorId?: string; metadata: Record<string, unknown> };
  export async function listModels(): Promise<ModelRecord[]>; // ORDER BY name
  export async function createModel(input: ModelInput & { name: string }, actor: ModelActor):
    Promise<{ ok: true; model: ModelRecord } | { ok: false; reason: "duplicate-legacy-id" }>;
  export async function updateModel(id: string, input: ModelInput, actor: ModelActor):
    Promise<{ ok: true; model: ModelRecord } | { ok: false; reason: "not-found" | "duplicate-legacy-id" }>;
  ```
- Produces (`assignments.ts`):
  ```ts
  export type AssignResult =
    | { ok: true; created: boolean }
    | { ok: false; reason: "session-not-found" | "model-not-found" | "model-retired" | "session-canceled" };
  export async function assignModel(sessionId: string, modelId: string, actor: ModelActor, opts?: { note?: string }): Promise<AssignResult>;
  export async function unassignModel(sessionId: string, modelId: string, actor: ModelActor):
    Promise<{ ok: true; removed: boolean } | { ok: false; reason: "session-not-found" | "model-not-found" }>;
  ```

- [ ] **Step 1: Write the failing test** in `e2e/ops-model-booking.spec.ts`:
  `test("a retired model isn't offered in the assign dropdown")` — insert an active model and a model with `retired_at = now()` (unique names), create a session + host as the first test does, log in as a ModelBooker, open `/ops/model-booking`, and on that host's row assert `row.locator("option", { hasText: activeName })` has count 1 and `row.locator("option", { hasText: retiredName })` has count 0.

- [ ] **Step 2: Run it, expect FAIL** — `pnpm test:e2e e2e/ops-model-booking.spec.ts -g "retired model"` → retired option count is 1.

- [ ] **Step 3: Implement `roster.ts`.** `auditActor` returns `{ actorId: userId, metadata: {} }` for users and `{ metadata: { via: "api", apiKeyId, apiKeyName } }` for keys. `createModel`/`updateModel` map Postgres `23505` to `duplicate-legacy-id`. `updateModel` locks the row (`FOR UPDATE` in a transaction), writes only the fields present in `input`, sets `retired_at = now()` / `NULL` when `retired` flips (unchanged if already in that state), and writes `MODEL_UPDATED` (metadata `{ modelId, changes: {field: [old, new]} }`) only if an info field actually changed, plus `MODEL_RETIRED` (`{ modelId, retired }`) only if `retired` actually changed. An empty or no-op input returns the current model with no audit entry. `createModel` writes `MODEL_CREATED` (`{ modelId, legacyId, name }`).

- [ ] **Step 4: Implement `assignments.ts`.** `assignModel`: 404-style reasons first (session row `status`, model row `retired_at`), then `session-canceled` / `model-retired`, then `INSERT … ON CONFLICT DO NOTHING`. Only when a row was inserted: `MODEL_ASSIGNMENT_RECORDED` audit (`{ sessionId, modelId, note }` + actor metadata) and the host email, with the body moved verbatim from the current `assignModelAction`. `unassignModel`: checks both rows exist, `DELETE`s, and audits `MODEL_ASSIGNMENT_REMOVED` only when `rowCount > 0`.

- [ ] **Step 5: Rewire the Server Actions** — `assignModelAction` calls `assignModel(…, { kind: "user", userId: ctx.id }, { note })`, inserts the `session_notes` row only when `created`, and maps results to the existing UI strings: `created: false` → `"That model is already assigned to this session."`, `model-retired` → `"That model is retired."`, `session-canceled` → `"That session is canceled."`, not-found → `"Session or model not found."`. `unassignModelAction` calls `unassignModel`. `page.tsx`'s model query adds `WHERE retired_at IS NULL`.

- [ ] **Step 6: Run the whole spec file, expect PASS** — `pnpm test:e2e e2e/ops-model-booking.spec.ts`, then `pnpm typecheck && pnpm lint`.

- [ ] **Step 7: Commit** — `git commit -m "Move model roster/assignment mutations into src/lib/models; hide retired models in model booking"`

---

### Task 3: API auth and request-parsing helpers

**Files:**
- Create: `src/lib/models/api.ts`, `src/lib/models/api.test.ts`
- Modify: `src/lib/reporting/scopes.ts` (append `"model_booking"` to `REPORT_SCOPES`, with a one-line comment that it's the one write scope)

**Interfaces:**
- Consumes: `requireApiKeyScope` (`src/lib/auth/apiKey.ts`), `ModelActor`/`ModelInput` (Task 2).
- Produces:
  ```ts
  export const FEED_DEFAULT_DAYS = 60;
  export const FEED_MAX_DAYS = 120;
  export function isUuid(value: string): boolean;
  export function parseDays(raw: string | null):
    { ok: true; days: number } | { ok: false; error: string };
  export function parseModelInput(body: unknown, mode: "create" | "update"):
    { ok: true; input: ModelInput } | { ok: false; error: string };
  export async function requireModelBookingKey(request: Request):
    Promise<{ ok: true; actor: ModelActor } | { ok: false; response: NextResponse }>;
  export function jsonError(status: number, error: string): NextResponse;
  ```

- [ ] **Step 1: Write the failing tests** in `src/lib/models/api.test.ts`:
  - `isUuid`: `true` for `"3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b"`, `false` for `"abc"`, `""`, and that UUID with a trailing `"x"`.
  - `parseDays`: `null` → 60, `""` → 60, `"1"` → 1, `"120"` → 120; `"0"`, `"121"`, `"-5"`, `"abc"`, `"1.5"` → `ok: false`.
  - `parseModelInput(…, "create")`: `{ name: "  Ana  ", email: "", phone: " 555 " }` → `{ name: "Ana", email: null, phone: "555" }`; `{ legacyId: 57, name: "X" }` → `legacyId: "57"`; missing/blank `name` → error; `{ name: 42 }` → error; `"str"`, `null`, `[]` → error; a 256-char `name` → error; `{ name: "X", retired: true }` → error (retire only via update).
  - `parseModelInput(…, "update")`: `{}` → `ok: true, input: {}`; `{ retired: true }` → ok; `{ retired: "yes" }` → error; `{ name: "" }` → error; `{ legacyId: null }` → `legacyId: null`.

- [ ] **Step 2: Run, expect FAIL** — `pnpm test src/lib/models/api.test.ts` → module not found.

- [ ] **Step 3: Implement `api.ts`.** Rules: strings are trimmed, an empty string becomes `null` for nullable fields, `legacyId` also accepts a safe integer (stringified), anything longer than 255 is rejected, and unknown keys are ignored. `requireModelBookingKey` calls `requireApiKeyScope(request, "model_booking")` and turns a failure into `jsonError(check.status, check.error)`; on success it returns `{ kind: "apiKey", apiKeyId: key.id, apiKeyName: key.name }`.

- [ ] **Step 4: Run, expect PASS** — `pnpm test src/lib/models/api.test.ts && pnpm typecheck`.

- [ ] **Step 5: Commit** — `git commit -m "Add model_booking API scope and request-parsing helpers"`

---

### Task 4: Roster endpoints (`/models`, `/models/:id`)

**Files:**
- Create: `src/app/api/model-booking/models/route.ts` (GET, POST), `src/app/api/model-booking/models/[id]/route.ts` (PATCH)
- Test: `e2e/model-booking-api.spec.ts` (new)

**Interfaces:**
- Consumes: Task 2 `listModels`/`createModel`/`updateModel`; Task 3 helpers. `parseModelInput(…, "create")` guarantees `name`, so POST passes its result to `createModel` as `ModelInput & { name: string }`.
- Produces, in the spec file for Task 5 to reuse: `async function createKey(scopes: string[]): Promise<{ raw: string; name: string }>`, which inserts into `api_keys (name, key_hash, key_prefix, scopes)` using `createHash("sha256").update(raw).digest("hex")` and `raw = randomBytes(24).toString("base64url")`. Plus `const auth = (raw: string) => ({ Authorization: \`Bearer ${raw}\` })`.

Status mapping: GET → 200 `ModelRecord[]`. POST → 201 `ModelRecord`, 400 on parse error or invalid JSON, 409 `duplicate-legacy-id`. PATCH → 200 `ModelRecord`, 404 for a non-UUID or unknown id, 400 on parse error, 409 `duplicate-legacy-id`. Read the body with `await request.json()` in a try/catch that turns a parse failure into 400 `"Body must be JSON."`.

- [ ] **Step 1: Write the failing tests** in `e2e/model-booking-api.spec.ts` (use `request` fixture):
  - `"requests without a key get 401, keys without model_booking get 403"`: `GET /api/model-booking/models` with no header → 401; with a `["users"]` key → 403.
  - `"creates, lists, updates and retires a model, audit-logged against the key"`: POST `{ legacyId: \`e2e-${Date.now()}\`, name: "E2E Model", email: "m@example.test", phone: "" }` → 201, body `phone === null`, `retired === false`. GET includes its `id`. PATCH `{ email: "new@example.test" }` → 200, `email` updated. PATCH `{ retired: true }` → `retired === true`, `retiredAt` non-null. SQL: `system_audit_logs` has one row each of `MODEL_CREATED`, `MODEL_UPDATED`, `MODEL_RETIRED` with `metadata->>'modelId' = id`, `actor_id IS NULL`, `metadata->>'apiKeyName' = key.name`.
  - `"duplicate legacyId is a 409 on create and on update"`: create A with `legacyId` L; POST another with L → 409; create B, PATCH B `{ legacyId: L }` → 409.
  - `"bad ids and bad bodies are 404/400, never 500"`: POST raw text `"not json"` (`data` as a string with `Content-Type: application/json`) → 400; POST `{ name: "x".repeat(300) }` → 400; PATCH `/models/not-a-uuid` → 404; PATCH `/models/${randomUUID()}` → 404.

- [ ] **Step 2: Run, expect FAIL** — `pnpm test:e2e e2e/model-booking-api.spec.ts` → 404s (routes don't exist).

- [ ] **Step 3: Implement both route files** per the status mapping (dynamic `params: Promise<{ id: string }>`, awaited).

- [ ] **Step 4: Run, expect PASS** — same command; then `pnpm typecheck && pnpm lint`.

- [ ] **Step 5: Commit** — `git commit -m "Add model-booking roster API endpoints"`

---

### Task 5: Session feed and assignment endpoints

**Files:**
- Create: `src/lib/models/sessionFeed.ts`, `src/app/api/model-booking/sessions/route.ts` (GET), `src/app/api/model-booking/sessions/[id]/models/[modelId]/route.ts` (PUT, DELETE)
- Test: `e2e/model-booking-api.spec.ts`

**Interfaces:**
- Consumes: Task 2 `assignModel`/`unassignModel`; Task 3 `parseDays`, `isUuid`, `requireModelBookingKey`, `jsonError`; Task 4's `createKey`/`auth`.
- Produces:
  ```ts
  export interface FeedSession {
    id: string; legacyId: string | null; startTime: string; endTime: string;
    sessionType: string; description: string | null; status: "Scheduled" | "Canceled";
    modelRequired: boolean; seriesId: string | null;
    models: { id: string; legacyId: string | null; name: string }[]; // ordered by name
  }
  export async function getSessionFeed(days: number): Promise<FeedSession[]>; // ORDER BY start_time
  ```

Status mapping: GET `/sessions` → 200 `FeedSession[]`, 400 from `parseDays`. PUT → 200 `{ sessionId, modelId, created }`, 404 for a non-UUID id or a `*-not-found` reason, 409 for `model-retired` / `session-canceled`. DELETE → 204 with no body, 404 same as PUT.

Test sessions are inserted by SQL inside the spec with `withSlotLock("Morning", …)` + `findOpenSlotBase(now, "Morning", [0], 35, 58)` (same helpers as every other dated spec), at that day's org start-of-day + 10h, `session_type 'R'`. A canceled session doesn't occupy a slot, so it needs no lock.

- [ ] **Step 1: Write the failing tests:**
  - `"assign is idempotent, supports several models, and unassign is idempotent"`: session S, models M1, M2 (via POST). PUT S/M1 → 200 `created: true`; PUT S/M1 → 200 `created: false`; PUT S/M2 → 200. GET `/sessions?days=120` → S's `models` ids are exactly `{M1, M2}`. DELETE S/M1 → 204, DELETE S/M1 → 204. Feed now shows only M2. SQL: exactly one `MODEL_ASSIGNMENT_RECORDED` row for `(S, M1)`.
  - `"retired models and canceled sessions can't be assigned; retiring keeps existing assignments"`: assign M to S, PATCH M `{ retired: true }`. Feed still lists M on S. PUT M on a second scheduled session S2 → 409. A canceled session C (SQL `status 'Canceled'`) with an active model → PUT 409. DELETE S/M (retired) → 204.
  - `"feed includes canceled sessions with legacyId and honours days"`: insert canceled C at day 45 with `legacy_id = \`e2e-${Date.now()}\``. GET with no `days` → C present with `status: "Canceled"` and that `legacyId`; `?days=30` → C absent; `?days=0`, `?days=121`, `?days=abc` → 400.
  - `"bad session/model ids are 404"`: PUT `/sessions/not-a-uuid/models/${M}` → 404; PUT `/sessions/${randomUUID()}/models/${M}` → 404; DELETE `/sessions/${S}/models/${randomUUID()}` → 404.

- [ ] **Step 2: Run, expect FAIL** — `pnpm test:e2e e2e/model-booking-api.spec.ts -g "assign|feed|session/model"` → 404s.

- [ ] **Step 3: Implement `getSessionFeed`** — a single query with `LEFT JOIN session_model_mapping`/`models`, `COALESCE(json_agg(json_build_object('id', m.id, 'legacyId', m.legacy_id, 'name', m.name) ORDER BY m.name) FILTER (WHERE m.id IS NOT NULL), '[]')`, `WHERE s.start_time >= now() AND s.start_time <= now() + make_interval(days => $1)`, no status filter. Map `Date` columns with `toISOString()`.

- [ ] **Step 4: Implement both route files** per the status mapping.

- [ ] **Step 5: Run the whole API spec plus model booking, expect PASS** — `pnpm test:e2e e2e/model-booking-api.spec.ts e2e/ops-model-booking.spec.ts`, then `pnpm typecheck && pnpm lint && pnpm test`.

- [ ] **Step 6: Commit** — `git commit -m "Add model-booking session feed and assignment API endpoints"`

---

### Task 6: Project docs

**Files:**
- Modify: `CLAUDE.md` — new "**Model Booking API implementation notes**" paragraph (where it sits in the notes order, what it's for, `src/lib/models/*` as the single mutation path, `model_booking` scope, `legacyId` for matching across `--reset` reloads, polling feed semantics, retired models keep assignments). Also update the "Model assignment is decoupled" domain bullet and the "Not yet built" `/admin/models` mention: the roster is now API-writable, and `/admin/models` would call the same lib.
- Modify (gitignored, local only, no commit): `docs/DesignDocument.md` §11 and §14 (roster sync resolved: API bridge, our roster official), `docs/MigrationPlan.md` §1 ("no ongoing bridge" now superseded for model data; `models.email/phone` replace `contact_info`; `sessions.legacy_id` now persisted).

- [ ] **Step 1: Make the edits.**
- [ ] **Step 2: Commit CLAUDE.md** — `git commit -m "Document the Model Booking API in CLAUDE.md"`

---

### Task 7: Rollout (each step needs the user's go-ahead; steps 4 and 5 are run by the user)

- [ ] **Step 1: Full suite** — `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`. Expected: green. (If logins start timing out across the board, `TRUNCATE login_attempts` locally first — see CLAUDE.md.)
- [ ] **Step 2: Push and PR** — push `model-booking-api` and open a PR to `main`. After the user merges, merge `main` into `staging` and push; Amplify runs the migration before building.
- [ ] **Step 3: Local rehearsal on the new dump.** Move `C:\Users\bryce\Downloads\robo_backup_20261108.zip` into `legacy_data/` (gitignored), extract the `.sql`, load it into a throwaway `mysql:8` container (StagingEnvironment.md "Reset flows"), run `pnpm migrate-legacy-data -- --reset` against local dev, then `pnpm seed`. This wipes and reloads local dev data. Check with SQL: `SELECT count(*) FROM sessions WHERE legacy_id IS NOT NULL` > 0 and `SELECT count(*) FROM models WHERE email IS NULL` = 0. Read aggregate counts only; never print row contents (PII).
- [ ] **Step 4: Staging reload (user-run).** Same command with `DATABASE_URL` pointed at staging, using the credential from Secrets Manager; it never goes into the transcript. Then spot-check `/ops/model-booking` on staging.
- [ ] **Step 5: Issue his key (user-run).** On staging `/admin/api-keys`: name "Legacy model booking", scope `model_booking` only. Send it to him out-of-band.
- [ ] **Step 6: External doc.** Get the staging base URL from the user. Write `docs/ModelBookingAPI.md` covering: purpose and roster ownership; auth; every endpoint with a curl example and its status codes; JSON shapes; that several models per session replaces legacy's single `sessions.modelId`; feed semantics (canceled is reported, absence ≠ canceled, sessions are never deleted, `seriesId`); retired models keep existing assignments; using `legacyId` to match his records, and that staging reloads regenerate UUIDs; that staging email is console-only. Commit it, publish it as a private Artifact, and give the user the link to share.
