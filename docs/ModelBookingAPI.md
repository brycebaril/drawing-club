# Model Booking API

For the developer of the legacy Robobooker system, whose tooling keeps running model booking (model logins, session requests, model communications) and talks to the new Basic Inquiry scheduling app through this API.

**Status:** live on staging (2026-11-10). Production is not live yet.

## How the two systems divide the work

- **The new app owns the sessions.** Read the upcoming sessions from `GET /sessions` and mirror them into your system, so models can request them there.
- **The new app's model roster is the official one.** Hire, update and retire models through `/models`, and keep your own copy for model logins. The longer-term goal is for the new app to cover this itself, using the same data, so nothing here is specific to your tooling.
- **Assignments are recorded in the new app** with `PUT`/`DELETE` on `/sessions/:id/models/:modelId`. The Model Booker can also still assign by hand in the new app, so treat the session feed as the source of truth for who is assigned.

### What's different from Robobooker

- **A session can have any number of models**: zero, one, or several (multi-model poses). Robobooker's single `sessions.modelId` becomes a `models` array, and you add and remove models one at a time.
- **No sentinel models.** "Model not yet booked" is an empty `models` array. A canceled session has `status: "Canceled"` instead of the `CANCELLED SESSION` model.
- **Ids.** Every model and session has a UUID `id` in the new app, and that's what goes in URLs. Your own ids are carried as `legacyId`:
  - model `legacyId` = your `merdels.id`
  - session `legacyId` = your `sessions.id`

  Sessions created in the new app after the migration have `legacyId: null`.

## Staging

| | |
| :--- | :--- |
| Base URL | `https://staging.d27yg9hidehduf.amplifyapp.com/api/model-booking` |
| Data | Loaded from your 2026-11-08 export. It's a copy of real production data, so please treat it accordingly. |
| API key | Sent to you separately. |
| Email | Staging doesn't send email; messages are only logged. |

**Staging gets reloaded** from newer exports from time to time. A reload regenerates every UUID, so after one, re-pull `/models` and `/sessions` and re-match your records by `legacyId`, which stays stable. Your API key survives reloads. Models or assignments you create on staging do not; the reload replaces them with whatever the export contains.

## Authentication

Send the key as a Bearer token on every request:

```bash
BASE=https://staging.d27yg9hidehduf.amplifyapp.com/api/model-booking
KEY=<your key>
curl -s "$BASE/models" -H "Authorization: Bearer $KEY"
```

| Status | Meaning |
| :--- | :--- |
| `401` | Missing, malformed, unknown or revoked key |
| `403` | The key is valid but doesn't have the `model_booking` scope |

## Conventions

- JSON in and out. Send `Content-Type: application/json` with bodies.
- Timestamps are ISO 8601 in UTC, e.g. `2026-11-12T03:00:00.000Z`. The studio runs on `America/Vancouver` time.
- Every error response is `{ "error": "<message>" }`.
- Text fields are trimmed. An empty string means "none" and is stored as `null`. The maximum length is 255 characters.
- Unknown body fields are ignored silently, so a typo like `{"retire": true}` returns 200 and changes nothing. Check the response body.

## Sessions

### `GET /sessions?days=N`

Returns every session starting between now and `N` days from now, ordered by start time. `N` defaults to 60 and can be 1 to 120.

```bash
curl -s "$BASE/sessions?days=60" -H "Authorization: Bearer $KEY"
```

```json
[
  {
    "id": "6f0c2a9e-…",
    "legacyId": "2811",
    "startTime": "2026-11-12T03:00:00.000Z",
    "endTime": "2026-11-12T06:00:00.000Z",
    "sessionType": "G",
    "description": null,
    "status": "Scheduled",
    "modelRequired": true,
    "seriesId": null,
    "models": [{ "id": "1b7d…", "legacyId": "57", "name": "Jane Doe" }]
  }
]
```

| Field | Notes |
| :--- | :--- |
| `status` | `Scheduled` or `Canceled` |
| `sessionType` | `L` Long Pose, `R` Regular, `G` Gesture, `P` Portrait, `S` Special, `X` Extra Long Pose, `Gallery` Gallery Hours, `Party` Party |
| `modelRequired` | `false` for sessions that don't need a model (Gallery Hours, Party, or anything the studio marked that way). It's read-only through this API. |
| `seriesId` | Groups the dates of a multi-week series, typically the same model across all of them. `null` otherwise. |
| `models` | Sorted by name. An empty array means no model is assigned yet. |

**How to read changes:** each call returns a full snapshot of the window. Poll it (every 10–15 minutes is plenty) and compare against what you have.

- **Canceled sessions stay in the snapshot**, with `status: "Canceled"`.
- **Sessions are never deleted.** A session that drops out of a later snapshot has moved out of the window, either because its start time passed or because it was rescheduled beyond `days`. It was not canceled.
- `400` if `days` isn't a whole number from 1 to 120.

## Models

Model shape:

```json
{
  "id": "1b7d…",
  "legacyId": "57",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "604-555-0100",
  "retired": false,
  "retiredAt": null
}
```

Contact details are private to the Model Booker and admins in the new app; they're never shown to members.

### `GET /models`

The full roster, retired models included, sorted by name.

### `POST /models`: hire

```bash
curl -s -X POST "$BASE/models" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"legacyId": "212", "name": "Jane Doe", "email": "jane@example.com", "phone": "604-555-0100"}'
```

- `name` is required. `legacyId`, `email` and `phone` are optional. `legacyId` can be a string or an integer.
- Returns `201` with the model.
  - `400`: a missing or blank `name`, a wrong type, a field over 255 characters, or a body that isn't JSON.
  - `409`: another model already has that `legacyId`.
- **Always send your `merdels.id` as `legacyId`.** It keeps the two rosters linked, and it makes retries safe: retrying a timed-out create returns `409`, which tells you the first attempt worked. Without a `legacyId`, a retry creates a duplicate model.
- A model can't be created already retired. Create it, then `PATCH` it.

### `PATCH /models/:id`: update or retire

Send only the fields you're changing: `name`, `email`, `phone`, `legacyId`, `retired`.

```bash
# update contact info
curl -s -X PATCH "$BASE/models/$MODEL_ID" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"email": "new@example.com"}'

# retire (or {"retired": false} to bring a model back)
curl -s -X PATCH "$BASE/models/$MODEL_ID" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"retired": true}'
```

- Returns `200` with the updated model.
  - `400`: invalid body.
  - `404`: unknown or malformed id.
  - `409`: the new `legacyId` belongs to another model.
- **Retiring a model doesn't touch their existing assignments.** If a retired model is booked on upcoming sessions, replace them explicitly (see below). A retired model can't be newly assigned.

## Assignments

### `PUT /sessions/:id/models/:modelId`: assign

```bash
curl -s -X PUT "$BASE/sessions/$SESSION_ID/models/$MODEL_ID" -H "Authorization: Bearer $KEY"
```

- Returns `200` with `{ "sessionId": "…", "modelId": "…", "created": true }`. `created` is `false` if the model was already assigned, so retrying is safe.
  - `404`: unknown or malformed session or model id.
  - `409`: the model is retired, or the session is canceled.
- On a new assignment the session's host (Session Manager) gets an email telling them a model was assigned.

### `DELETE /sessions/:id/models/:modelId`: unassign

```bash
curl -s -X DELETE "$BASE/sessions/$SESSION_ID/models/$MODEL_ID" -H "Authorization: Bearer $KEY"
```

- Returns `204` with no body, whether or not the model was assigned, so this is safe to retry too.
  - `404`: unknown or malformed session or model id.
- This works for retired models.

### Replacing a model

To replace a model, `DELETE` the old assignment, then `PUT` the new one. There's no single "replace" call, so your updates and the Model Booker's manual changes in the new app can't overwrite each other.

## Audit trail

Every change made through the API is recorded in the new app's audit log under the API key's name, so changes from your tooling are distinguishable from ones the Model Booker makes by hand.
