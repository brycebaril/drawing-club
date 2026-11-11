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
| API key | Sent to you separately, or create your own (see [Access](#access)). |
| Email | Staging doesn't send email; messages are only logged. |

**Staging gets reloaded** from newer exports from time to time. A reload regenerates every UUID, so after one, re-pull `/models` and `/sessions` and re-match your records by `legacyId`, which stays stable. Your API key survives reloads. Models or assignments you create on staging do not; the reload replaces them with whatever the export contains.

## Access

### Getting a key

Keys are created by an admin of the new app at `/admin/api-keys`, and the full key is shown only once. If your own account in the new app is an Admin (Robobooker admins were migrated as admins), you can create your own:

1. Log in at `https://staging.d27yg9hidehduf.amplifyapp.com/auth/login` with your Robobooker email address (or your new-app username) and your Robobooker password.
2. Admin accounts require MFA, so the first login walks you through setting up an authenticator app.
3. Go to `/admin/api-keys` and create a key with **only** `model_booking` checked. Admins can create keys with other scopes too, but your tooling needs only this one.

**After a staging reload** your password stays the same, since it comes from the Robobooker export, but you'll need to set up MFA again. API keys survive reloads.

### What a key can and can't do

| Can | Can't |
| :--- | :--- |
| Read upcoming sessions, canceled ones included | See or change members, bookings, tickets or payments |
| Read the model roster, including contact details | Create, reschedule or cancel sessions |
| Hire, update and retire models | Change a session's type, capacity or `modelRequired` |
| Assign and unassign models | |

That's roughly the new app's Model Booker role plus roster management. Access comes only from the key's `model_booking` scope. Each key records the admin who created it, but the API doesn't re-check that person's roles or account status on each request: removing their Admin role or suspending their account leaves keys they already made working. To cut off access, an admin revokes the key at `/admin/api-keys`.

### Seeing your changes in the app

Log in with an account that has the Model Booker role or is an Admin and open `/ops/model-booking`. It lists the next 60 days of sessions with their assigned models, and a "Needs a model" filter. Admins can also use `/admin/sessions`.

### MCP

There's no MCP server for this API. It's plain HTTP + JSON, so anything with an HTTP client can use it.

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

To replace a model, `PUT` the new one, then `DELETE` the old one. Assigning first means that if the new assignment fails (the model is retired, say), the session keeps its current model. There's no single "replace" call, so your updates and the Model Booker's manual changes in the new app can't overwrite each other.

## PHP

A minimal client for PHP 7.4 and later, using only the standard `curl` and `json` extensions. It was tested end to end against the API on PHP 7.4 and 8.3. Save it as `model-booking-client.php` and set `MODEL_BOOKING_API_KEY` in the environment; `MODEL_BOOKING_API_BASE` is optional and defaults to staging.

Each function returns data on success and throws a `RuntimeException` otherwise, with the HTTP status as the exception code: `404` unknown id, `409` conflict, `401`/`403` key problem.

```php
<?php
/**
 * Minimal Model Booking API client. PHP 7.4+, using the standard curl and json extensions.
 * Set MODEL_BOOKING_API_KEY in the environment and keep the key out of source control.
 */

function mb_base_url(): string
{
    return getenv('MODEL_BOOKING_API_BASE')
        ?: 'https://staging.d27yg9hidehduf.amplifyapp.com/api/model-booking';
}

/**
 * Sends one request and returns [HTTP status, decoded JSON body or null].
 * Throws on a network failure, on 401/403 (bad or under-scoped key) and on 5xx,
 * so callers only handle the statuses each endpoint documents.
 */
function mb_request(string $method, string $path, ?array $body = null): array
{
    $headers = [
        'Authorization: Bearer ' . getenv('MODEL_BOOKING_API_KEY'),
        'Accept: application/json',
    ];
    $ch = curl_init(mb_base_url() . $path);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    if ($body !== null) {
        // (object) so an empty array is sent as {} rather than [].
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode((object) $body));
        $headers[] = 'Content-Type: application/json';
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

    $raw = curl_exec($ch);
    if ($raw === false) {
        throw new RuntimeException("$method $path failed: " . curl_error($ch));
    }
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $decoded = $raw === '' ? null : json_decode($raw, true);
    if ($status === 401 || $status === 403 || $status >= 500) {
        throw new RuntimeException("$method $path: HTTP $status " . mb_error($decoded), $status);
    }
    return [$status, $decoded];
}

/** The "error" message from an error response, or '' if there isn't one. */
function mb_error($decoded): string
{
    return is_array($decoded) && isset($decoded['error']) ? $decoded['error'] : '';
}

function mb_fail(string $what, int $status, $body): RuntimeException
{
    return new RuntimeException("$what: HTTP $status " . mb_error($body), $status);
}

/**
 * Upcoming sessions keyed by id. A session missing from a later call has moved
 * out of the window; it was not canceled (canceled ones stay, with status "Canceled").
 */
function mb_upcoming_sessions(int $days = 60): array
{
    [$status, $body] = mb_request('GET', "/sessions?days=$days");
    if ($status !== 200) {
        throw mb_fail('Listing sessions', $status, $body);
    }
    return array_column($body, null, 'id');
}

/** The full roster, retired models included. */
function mb_models(): array
{
    [$status, $body] = mb_request('GET', '/models');
    if ($status !== 200) {
        throw mb_fail('Listing models', $status, $body);
    }
    return $body;
}

/** Finds a model by your merdels.id. */
function mb_find_model_by_legacy_id($legacyId): ?array
{
    foreach (mb_models() as $model) {
        if ($model['legacyId'] === (string) $legacyId) {
            return $model;
        }
    }
    return null;
}

/**
 * Hires a model. Pass your merdels.id as $legacyId: then a retried call returns
 * the model the first call created instead of making a duplicate.
 */
function mb_hire_model($legacyId, string $name, ?string $email = null, ?string $phone = null): array
{
    [$status, $body] = mb_request('POST', '/models', [
        'legacyId' => (string) $legacyId,
        'name' => $name,
        'email' => $email,
        'phone' => $phone,
    ]);
    if ($status === 201) {
        return $body;
    }
    if ($status === 409) {
        // Already hired, e.g. this is a retry of a request that timed out.
        return mb_find_model_by_legacy_id($legacyId);
    }
    throw mb_fail("Hiring $name", $status, $body);
}

/**
 * Updates a model. $changes holds any of name, email, phone, legacyId, retired,
 * e.g. ['email' => 'new@example.com'] or ['retired' => true]. Returns the updated model.
 */
function mb_update_model(string $modelId, array $changes): array
{
    [$status, $body] = mb_request('PATCH', "/models/$modelId", $changes);
    if ($status !== 200) {
        throw mb_fail('Updating model', $status, $body);
    }
    return $body;
}

/**
 * Assigns a model to a session. Returns true if newly assigned, false if it already was.
 * Throws on 404 (unknown id) and 409 (retired model or canceled session).
 */
function mb_assign(string $sessionId, string $modelId): bool
{
    [$status, $body] = mb_request('PUT', "/sessions/$sessionId/models/$modelId");
    if ($status !== 200) {
        throw mb_fail('Assigning model', $status, $body);
    }
    return $body['created'];
}

/** Removes a model from a session. Succeeds whether or not it was assigned. */
function mb_unassign(string $sessionId, string $modelId): void
{
    [$status, $body] = mb_request('DELETE', "/sessions/$sessionId/models/$modelId");
    if ($status !== 204) {
        throw mb_fail('Unassigning model', $status, $body);
    }
}

/** Swaps one model for another. Assigns first, so if that fails the session keeps its model. */
function mb_replace(string $sessionId, string $oldModelId, string $newModelId): void
{
    mb_assign($sessionId, $newModelId);
    mb_unassign($sessionId, $oldModelId);
}
```

Using it:

```php
<?php
require 'model-booking-client.php';

// Mirror upcoming sessions into your own table.
foreach (mb_upcoming_sessions(60) as $id => $session) {
    // $session['legacyId'] is your sessions.id for sessions that came from Robobooker,
    // null for sessions created in the new app. Upsert your copy keyed by $id.
    $canceled = $session['status'] === 'Canceled';
    $assignedModelIds = array_column($session['models'], 'id');
}

// Hire (212 is your merdels.id), book, swap and retire.
$jane = mb_hire_model(212, 'Jane Doe', 'jane@example.com', '604-555-0100');
mb_assign($sessionId, $jane['id']);
mb_replace($sessionId, $jane['id'], $otherModelId);
mb_update_model($jane['id'], ['retired' => true]);
```

## Audit trail

Every change made through the API is recorded in the new app's audit log under the API key's name, so changes from your tooling are distinguishable from ones the Model Booker makes by hand.
