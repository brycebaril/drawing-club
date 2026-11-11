# Model Booking API — design

Date: 2026-11-10. Status: approved in conversation, pending written-spec review.

## Context

The legacy Robostrar/Robobooker developer will keep running model booking (model logins, model
requests, model communications) from his own system and tooling. Instead of the Model Booker
manually double-entering assignments into this app (Design Doc §11), his tooling talks to this app
over an API. This resolves Design Doc §14's open "Model Roster Synchronization" question in favour
of an API bridge, and supersedes MigrationPlan §1's "no ongoing bridge" statement for model data.

Decisions made with the user:

- **This app's `models` table is the official roster.** His system writes hires/updates/retirements
  to our API and keeps its own local copy for model logins.
- **Build first, document after.** The external doc (`docs/ModelBookingAPI.md`) is written once the
  API is deployed to staging, so it matches what he tests against.
- **Polling, not webhooks.** He polls a full snapshot of the upcoming window and diffs it himself.
- **Long-term goal:** his tooling can be retired. The same lib functions the API calls are what a
  future `/admin/models` page will call, so nothing about the data model is shaped around him.

Out of scope: model logins and model session requests (stay in his system), an `/admin/models`
page, webhooks, an `updated_since` filter, toggling `model_required` via the API.

## 1. Schema (one migration)

`models`:
- add `email varchar(255)`, `phone varchar(255)`, `retired_at timestamptz` (NULL = active)
- backfill from `contact_info` (legacy migration wrote `"email / phone"`, seed wrote `"email"`):
  `email = split_part(contact_info, ' / ', 1)`, `phone = NULLIF(split_part(contact_info, ' / ', 2), '')`;
  then drop `contact_info`. `scripts/seed.ts`'s `upsertModel` writes `email` instead.
- unique index on `legacy_id` (partial, `WHERE legacy_id IS NOT NULL`)

`sessions`:
- add `legacy_id varchar(255)` (NULL for sessions created in this app)

Readers of `contact_info` (`src/lib/ops/payouts.ts`, `src/app/ops/financials/csv/route.ts`) switch
to `concat_ws(' / ', m.email, m.phone)` so the payout report/CSV output is unchanged.

Legacy migration scripts:
- `scripts/legacy-migration/models.ts`: insert `email`, `phone` directly instead of `contact_info`
- `scripts/legacy-migration/sessions.ts`: insert `legacy_id = String(row.id)`

## 2. Auth

Reuse `api_keys` + `requireApiKeyScope` (`src/lib/auth/apiKey.ts`). Add `"model_booking"` to
`REPORT_SCOPES` (`src/lib/reporting/scopes.ts`) so `/admin/api-keys` can issue it. 401/403 semantics
unchanged. His staging key gets only this scope and is delivered out-of-band, never in the doc.

`api_keys` is not in `migrate-legacy-data`'s `RESET_TABLES`, so a staging key survives legacy-data
reloads.

## 3. Endpoints

All under `/api/model-booking/`, JSON in/out, `Authorization: Bearer <key>`, scope `model_booking`.
Timestamps are ISO 8601 UTC. Errors are `{ "error": "<message>" }`.

| Method | Path | Behaviour |
|---|---|---|
| GET | `/sessions?days=N` | Sessions with `start_time` in `[now, now + N days]`, default 60, max 120. Includes `Canceled` sessions. |
| GET | `/models` | Full roster, retired included. |
| POST | `/models` | Create. Body `{legacyId?, name, email?, phone?}`. 201 + model. 409 on duplicate `legacyId`. 400 if `name` blank. |
| PATCH | `/models/:id` | Partial update of `name`/`email`/`phone`/`legacyId`, and `retired: boolean`. 200 + model. 404 unknown id. |
| PUT | `/sessions/:id/models/:modelId` | Assign. Idempotent (200 whether new or existing). 404 unknown session/model. 409 if model retired or session `Canceled`. |
| DELETE | `/sessions/:id/models/:modelId` | Unassign. Idempotent (204 whether or not it was assigned). 404 unknown session/model. |

Session shape:

```json
{
  "id": "uuid", "legacyId": "1234" | null,
  "startTime": "...", "endTime": "...",
  "sessionType": "L|R|G|P|S|X|Gallery|Party",
  "description": "..." | null,
  "status": "Scheduled|Canceled",
  "modelRequired": true,
  "seriesId": "uuid" | null,
  "models": [{ "id": "uuid", "legacyId": "57" | null, "name": "..." }]
}
```

Model shape: `{ id, legacyId, name, email, phone, retired, retiredAt }`.

Feed semantics the doc must spell out: a session missing from a later snapshot has moved out of the
window (time edited, or now in the past) — it is **not** a cancellation; cancellations always appear
with `status: "Canceled"`. Sessions are never deleted. `seriesId` groups multi-week series
occurrences (typically same model across dates).

`:id`/`:modelId` path params are our UUIDs only; `legacyId` is for matching, not addressing.

## 4. Shared logic

New `src/lib/models/` module, the single place these mutations happen:

- `assignModel(sessionId, modelId, actor)` / `unassignModel(...)` — moved out of
  `src/app/ops/model-booking/actions.ts`. Keeps current behaviour: host email on assignment,
  `MODEL_ASSIGNMENT_RECORDED`/`MODEL_ASSIGNMENT_REMOVED` audit entries. Adds the retired/canceled
  guards (so the UI gets them too).
- `createModel`, `updateModel` — audit types `MODEL_CREATED`, `MODEL_UPDATED`, `MODEL_RETIRED`
  (`MODEL_RETIRED` covers both directions with `{retired: bool}` in metadata).

`actor` is either a user id (UI, via `requireOpsRole`) or an API key (`actorId` NULL — already
allowed by `writeAuditLog` — with `{ via: "api", apiKeyId, apiKeyName }` in metadata).

The UI's assign-note feature (session note + note in host email) stays UI-only.

`/ops/model-booking`'s dropdown filters `WHERE retired_at IS NULL`.

## 5. Testing

- `e2e/model-booking-api.spec.ts` via Playwright `request` (same pattern as
  `e2e/admin-dashboard.spec.ts`'s Stats API checks), with a key inserted by direct SQL:
  401 without key, 403 with a key lacking the scope; create/update/retire a model; assign,
  re-assign (idempotent), unassign, re-unassign; assigning a retired model → 409; a canceled session
  appears in the feed with `status: "Canceled"`; duplicate `legacyId` → 409.
- Existing `e2e/ops-model-booking.spec.ts` must still pass against the moved logic.
- Session dates must use a slot no other spec file owns (see CLAUDE.md's e2e slot-ownership notes).

## 6. Rollout

1. Merge → push to `staging`; Amplify runs the schema migration before build.
2. Move `robo_backup_20261108.zip` into gitignored `legacy_data/`; reload staging with
   `pnpm migrate-legacy-data -- --reset` from a throwaway MySQL container. Needs the staging DB
   credential — run by the user, or this shell after `aws login`. Never paste the credential into a
   transcript.
3. Issue his `model_booking`-only key on staging `/admin/api-keys`; send it out-of-band.
4. Write `docs/ModelBookingAPI.md` (tracked) + publish a private share link. Contents: staging base
   URL, auth, every endpoint with a curl example, the multi-model difference from legacy's single
   `sessions.modelId`, feed semantics above, and "staging reloads regenerate our UUIDs — re-match by
   `legacyId`".
5. Update local docs: Design Doc §11/§14, MigrationPlan §1, CLAUDE.md implementation notes.
