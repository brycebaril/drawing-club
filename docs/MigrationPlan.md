# **Migration Plan: Legacy System → Life Drawing Society Scheduling System**

## **1. Overview & Scope**

The organization currently runs a legacy system (Robostrar/Robobooker) that serves two purposes:

1. It holds existing **member, membership history, booking, and transaction data** that needs to be migrated into the new system's Postgres database (Design Doc §13) as a **one-time cutover**.
2. It is also the **model-request system** that, per Design Doc §11, will **stay in active, ongoing use** — models continue submitting availability/requests there, and the Model Booker volunteer manually mirrors assignments into the new system. This is an intentional, permanent (Phase 1) workflow, not a migration gap.

**This plan covers only (1).** No ongoing sync/bridge to the legacy system is being built — access is a database backup/dump rather than a live connection, which rules out a bridge anyway, and Design Doc §11 already specifies manual dual-entry as the intended model workflow. Model roster synchronization is explicitly listed as an open question in Design Doc §14 and is out of scope for this migration plan.

## **2. Status: Analysis Complete**

The legacy dump (`legacy_data/robo_backup_20260524.sql`) has been reviewed in full. **`docs/LegacyDataAnalysis.md`** is the source of truth for the table-by-table mapping matrix, data-quality findings, and the reasoning behind every migrate/transform/archive/skip verdict — this document doesn't repeat that analysis, only the decisions and field-level mapping that follow from it.

All five original open questions are resolved (see `LegacyDataAnalysis.md`'s Decisions section), plus three more surfaced while drafting the field-level mapping below (member names, username, migration traceability). **The last pending item — the two undocumented enums (`sessions.status`, `registration_logs.what`) — is now resolved too**, confirmed directly by the org's former Robostrar admin (`LegacyDataAnalysis.md`'s Appendix). The confirmed answer **overturned** this plan's original best-guess `sessions.status` mapping, not just filled it in: `status` turned out to track the model-confirmation daemon's workflow, not booking/cancellation — see §5's `sessions` row for the correction, already implemented in `scripts/legacy-migration/sessions.ts`.

**Password hashing is confirmed bcrypt** (`$2y$`, 60 characters — PHP's standard `password_hash()` default), verified directly against the dump's `PasswordHash` columns (format/length only, no hash values inspected). This resolves the format half of §7 below. Two `session_attendees` rows have a 1-character `x` value instead of a real hash — almost certainly disabled/locked accounts, not migratable credentials; see §7.

**The migration scripts described below are built and verified** (`scripts/migrate-legacy-data.ts` + `scripts/legacy-migration/*`, run via `pnpm migrate-legacy-data`) — every count in §5's tables below was confirmed against the real dump in an ephemeral MySQL container, matched exactly against independent `COUNT(*)` queries, and committed against a throwaway Postgres staging database (never the real dev/staging/production DB). A handful of real refinements surfaced only once actual field-mapping code was written against real data, not from re-reading the plan on paper — captured inline in §5 below where they apply. `pnpm typecheck`/`pnpm lint`/`pnpm test` all pass clean with the migration code in place. Still not done: an actual run against a real `staging` environment (§8 phase 4) — everything so far has been local rehearsal.

## **3. Schema Prerequisites**

Three real schema/app changes are needed **before** the data-migration scripts can run — these are ordinary feature work for this codebase, not migration-script logic, and should land as their own PR(s) ahead of cutover:

1. **`users.display_name`** (new nullable `text` column, backfilled for migrated accounts from legacy `firstName`+`lastName`). Decided over separate `first_name`/`last_name` columns — this app has no concept of a person's name today at all, and a single display field is the simpler addition. **Also needs the registration flow (`src/app/auth/register/*`) updated to collect it going forward** — this isn't just a migration-time backfill, or every account created after cutover would have a blank name again.
2. **`users.legacy_id`** (new nullable `varchar(255)` column, mirroring the existing `models.legacy_id` precedent from the initial schema). Lets a specific migrated member's data be traced back and corrected after cutover without re-deriving who's who from scratch.
3. **`users.username` is kept, not dropped.** This was seriously considered and rejected: legacy has no username concept at all (attendees authenticate by email only), which raised the question of moving this app to email-based login entirely. But `username` in this codebase isn't just a login credential — it's the general-purpose unique human identifier used across roughly 48 files, including pass-sharing (a transferable pass is shared "to a specific named member" by username, not email — see CLAUDE.md's Pass sharing notes), admin host/session-manager pickers, `filterUsers` admin search, audit logs, and CSV exports. `display_name` isn't unique (two members can share a name), so it can't safely replace username in any of those disambiguation-dependent spots. Migrated accounts get a **derived username: the email's local-part (before `@`), with a numeric suffix on collision** (verified zero collisions exist among legacy emails themselves, so collisions can only arise against *this app's* existing accounts, if any). Eliminating username as a broader redesign remains a legitimate idea, but it's a real refactor of its own — out of scope here.
4. **`volunteer_role_name` gains a `Board` value** (`pgm.addTypeValue`), per §5's `board_status` resolution — a Board Member is a volunteer type that also carries `base_role = 'Admin'`.
5. **New `legacy_attendance_history` table**, for the bulk of `seat_registrations` (25,725 rows) that represent already-completed sessions. Deliberately **separate from the live `passes`/`transactions` tables**, not a reuse of them — see §5's `seat_registrations` row for why. Proposed shape:
   - `id uuid primary key`
   - `legacy_registration_id varchar(255)` — traceability back to `seat_registrations.id`
   - `session_id uuid references sessions` — the migrated (historical) session
   - `user_id uuid references users` — the attendee
   - `registered_by_user_id uuid references users` — who made the booking (self or admin), from `seat_registrations.registeredById`
   - `checked_in boolean not null` — from `seat_registrations.attended`
   - `funded_by text not null` — `'ticket_balance'` or `'membership'`, from whether `passId` was NULL, kept as a plain marker since no real per-row price is reconstructable this far back (see §5)

## **4. Future vs. Historical Split**

**Not every legacy session is purely historical.** The dump (created 2026-05-24) contains 38 sessions and 57 registrations dated on or after its own creation date — already-booked *future* sessions that were still live and spendable at the moment the dump was taken. Whenever the actual cutover happens, the same will be true relative to that day: some number of members will have real upcoming bookings on the legacy system that must land as genuinely live, bookable state in the new system — not archived as low-fidelity history.

The migration scripts must therefore split on session date **relative to the actual cutover date at run time** (never a date hardcoded during planning):

- **Sessions dated before cutover** → migrate as historical: a real `sessions` row (for referential completeness) plus `legacy_attendance_history` rows per §3.4. No `passes`/`transactions` rows are synthesized for these — see §5's `seat_registrations` row for the reasoning.
- **Sessions dated on/after cutover** → migrate as live: a real `sessions` row (`status = 'Scheduled'`), and each registration becomes a real, spendable `passes` row (`session_id` set, `status = 'Assigned'`) so the booking is genuinely honored post-cutover. A ticket-balance-funded seat gets the same weighted-average `effective_price` as §5's `numTickets` conversion (drawn from the same purchase history); a membership-funded seat (`passId IS NOT NULL`) gets `effective_price = 0.00`, matching how a `free_studio_seat` entitlement already works (no per-session charge to a paid member).

## **5. Field-by-Field Mapping**

Only tables with a **Migrate** or **Transform** verdict in `LegacyDataAnalysis.md`'s mapping matrix are detailed here — the full 31-table matrix (including every **Archive-only**/**Skip** table and its reasoning) lives there and isn't duplicated.

### `users` ← `session_attendees`

| New column | Source | Notes |
|---|---|---|
| `id` | generated | fresh `gen_random_uuid()` |
| `legacy_id` | `session_attendees.id` | new column, §3.2 |
| `username` | derived from `email` | local-part, dedupe on collision — §3.3 |
| `display_name` | `firstName` + `lastName` | new column, §3.1 |
| `email` | `email` | direct copy — verified no dupes, no nulls |
| `password_hash` | `PasswordHash` | direct copy (bcrypt, confirmed §2) — **except** the 2 `x`-value rows, which get a random unusable placeholder hash instead and are force-reset on first login attempt regardless (§7) |
| `email_verified_at` | — | no legacy equivalent; set to migration timestamp (a legacy account's email was implicitly trusted by years of use) |
| `base_role` | derived from `owned_passes`/`owned_entitlements` | default `AccountHolder`; promoted to `Admin` automatically for anyone holding `sysadmin_power`/`registrar_power`/`dataview_power`/`bio_view_power`/`board_status` (see `volunteer_roles` below) — the script does this, not a manual post-migration pass |
| `membership_expires_at` | `MAX(owned_passes.validThru)` across a user's `member_status`-entitled rows | this app's actual MBR-derivation reads this stored field directly (`src/lib/auth/roles.ts`) — a real gap caught only once the script was written and cross-checked against the running app's code: an earlier draft populated `membership_history` but left this column null, which would have silently defaulted every migrated member to non-member pricing/booking-window despite real membership history existing |
| `status` | `suspended_attendee_accounts` | `'Suspended'` for the 1 currently-suspended account (see `LegacyDataAnalysis.md`'s Compliance-sensitive callout), `'Active'` otherwise |
| `created_at` | — | no legacy equivalent at all (`LegacyDataAnalysis.md` finding #7) — set to migration timestamp |

### `models` ← `merdels`

Direct mapping using the existing `legacy_id` column — no schema change needed. Exclude sentinel rows `id=74` ("CANCELLED SESSION") and `id=100` ("model not yet booked"). The 2 duplicate `merdels.EMail` addresses need manual resolution before import (merge or disambiguate) since `contact_info` has no uniqueness requirement in the new schema but two identical rows would be confusing in the roster.

### `volunteer_roles` + `users.base_role` ← `owned_passes` (role/membership split, via `owned_entitlements`)

Per `LegacyDataAnalysis.md` finding #3, `owned_passes` is a membership/role concept, not a pass/currency one. Each `owned_passes` row's granted `entitlements` (via `owned_entitlements`) determines its destination:

| Legacy entitlement (`entitlements.name`) | Destination |
|---|---|
| `member_status` | a `membership_history` row (see below) |
| `volunteer_status`, `manager_status`, `model_booker` | a `volunteer_roles` row — exact `volunteer_role_name` enum value (`SessionManager`/`ContentEditor`/`ModelBooker`/`Controller`) needs a considered pass against each legacy pass's `passName` text (e.g. "Model Booker Pass" → `ModelBooker`), not a 1:1 automatic mapping, since the enums don't share vocabulary |
| `board_status` | **Resolved**: a new `Board` value on `volunteer_role_name` (schema change — the enum previously had no Board concept), plus `base_role = 'Admin'`. Decided directly with the org: a Board Member is a volunteer type that also carries admin status. This is also why board members will be in scope for a not-yet-built future feature — volunteers get a free pass every week as long as they hold fewer than 50 free passes in their wallet (cap configurable via `system_settings`) — noted here for context; that feature is explicitly out of scope for this migration and hasn't been built |
| `sysadmin_power`, `registrar_power`, `dataview_power`, `bio_view_power` | `base_role = 'Admin'` (all four read as "trusted with sensitive system access" in the legacy `entitlements` table's own description) — needs the org's confirmation this reads correctly per-person, since `Admin` is a broad, all-access role in the new system with no finer-grained equivalent to `dataview_power`/`bio_view_power`'s narrower legacy scope |

The ~3 `passKind=0` miscellaneous rows ("Presidential Magic Wand," "BONANZA PASS," "Test Edition" — see `LegacyDataAnalysis.md`'s mapping matrix) need individual manual review; they don't fit this table's pattern.

**Two more real gaps surfaced only once the actual `passName`/entitlement combinations were queried, not guessable from the table structure alone:**

1. **`free_studio_seat` (unlimited free attendance for role-holders) has no equivalent in this app's pass economy at all**, and the migration script deliberately does **not** synthesize passes to approximate it — this app's membership never grants unlimited free seats (it only affects pricing tier and booking-window length), so there's no finite number of passes that would honestly represent "unlimited." This is the same shape as the not-yet-built "volunteers get a free pass every week, capped at a configurable wallet limit" feature raised during migration planning — that feature, once built, is the real intended replacement. Until then, role-holders who previously had free unlimited attendance will need to actually spend passes like anyone else post-cutover; flag this to the org as a real, user-facing behavior change, not just a migration footnote.
2. **24 `owned_passes` rows carry only generic `volunteer_status` with no other specific entitlement** — this app has no generic "volunteer, unspecified" role, only the five named sub-roles, so these have no automatic destination. Quantified against the real dump: 7× Studio Cleaner, 4× Gallery Coordinator, 4× Past Board Member, 3× BIO Manager, 2× Social Media Coordinator, 1× each of Membership Coordinator ID / Financial Clerk / Studio Coordinator / Special Sessions Coordinator. The script flags every one individually (by `owned_passes.id`, never by name/PII) for manual review rather than guessing — "Financial Clerk," in particular, sounds like a plausible match for this app's `Controller` role ("Financial reviewer" per `SiteOutline.md`), but that's a real access-granting decision that deserves the org's explicit call, not an inferred one.

### `membership_history` ← `owned_passes` (the `member_status`-entitled subset, ~705 rows)

| New column | Source |
|---|---|
| `user_id` | migrated `session_attendees.id` → `users.id` |
| `transaction_id` | resolve via `store_order_components.passId` → `store_orders.invoiceId` → migrated `transactions.id`, where resolvable (see `transactions` below — not every membership pass has a resolvable order, e.g. admin-granted comp memberships) |
| `valid_from` | `owned_passes.validFrom` |
| `valid_until` | `owned_passes.validThru` |
| `granted_by` | — no legacy equivalent (no admin-actor column on `owned_passes`); left `NULL` |

### `transactions` ← `store_order_components` (fulfilled orders only, `status = 10`, **9,289 line items**, not 9,196)

**Refined during implementation**: this migrates **one row per `store_order_components` line item, not per `store_orders` order.** ~1% of fulfilled orders (101 of 10,238) bundle more than one line item in a single checkout (e.g. a ticket purchase and a membership renewal together) — verified directly against the dump. Component prices were confirmed to sum exactly to their order's total for every fulfilled order (zero mismatches, zero nulls), so splitting this way loses nothing and gains the ability for a migrated pass/membership row to link to the *specific* purchase that paid for it, not just "the order it happened to ship alongside." This is why the row count above (9,289) differs from the order count (9,196) — both are correct, they're just counting different things.

| New column | Source | Notes |
|---|---|---|
| `user_id` | `store_orders.customerId` (via the component's order) → migrated `users.id` | |
| `gateway_ref_id` | synthetic `legacy-invoice-{invoiceId}-{componentId}` | this app's Stripe integration expects a real gateway reference; legacy used PayPal exclusively (`processor` 1/2). The `legacy-` prefix is the reserved marker so `/ops/financials`/`/admin/dashboard` revenue reporting can exclude legacy-era rows from Stripe-specific logic (fee lookups, payout-batch matching) — implemented as a string prefix, not a new schema column |
| `amount_paid` | `store_order_components.price` (the specific line item's price, not the order's `total`) | |
| `processing_fee`, `net_amount` | — | no legacy equivalent (PayPal fee data was never captured); left `NULL` |
| `charge_status` | — | always `'Succeeded'` (only fulfilled orders migrate) |
| `item_type` | derived from `store_order_components.sku` | `SinglePass` for SKUs 1/101, `PassPack` for 5/7/105 (5-pack and 10-pack collapse to the same enum value — the new schema doesn't distinguish pack size at the transaction level, only via how many `passes` rows share the `transaction_id`), `MembershipRenewal` for 500/501/502 |
| `created_at` | `store_orders.date` (via the component's order) | |

The 1,143 unpaid/abandoned orders (`status = 0`) are **not migrated** — no charge occurred, nothing to reconcile.

### `passes` — two distinct sources, kept structurally separate

1. **From `owned_passes`, the `volunteer_status`/`manager_status`/`model_booker`-entitled rows that also imply a spendable seat allowance** (if any — needs the org's confirmation against real `passName` values whether e.g. a "Session Manager Pass" also grants free session attendance, or is purely a role marker with no seat economy attached).
2. **From `session_attendees.numTickets` (the current-balance conversion, Decision 1 in `LegacyDataAnalysis.md`)**: for each of the 1,120 users with `numTickets > 0`, synthesize N `passes` rows (`status = 'Available'`, `is_transferable = false`, `owner_id` = migrated user) at that user's **weighted-average price paid per ticket** across their full `store_order_components` purchase history (all single/5-pack/10-pack SKUs). `transaction_id` is left `NULL` for these synthetic rows — they don't correspond to one specific historical purchase, and forcing a link to an arbitrary one of the user's several orders would misrepresent the data.
3. **From future-dated (§4) `seat_registrations`**: real spendable/spent passes as described in §4, not part of the balance conversion above.

### `sessions` ← `sessions` (2,406 rows, all migrate — both past and future per §4)

| New column | Source | Notes |
|---|---|---|
| `status` | `sessions.modelId` (the `CANCELLED_SESSION` sentinel, id 74) | **Resolved, and corrected from an earlier wrong guess** (`LegacyDataAnalysis.md` Appendix): `sessions.status` is not a booking/cancellation state at all — confirmed by the org's former admin, it tracks the *model-confirmation daemon's workflow* (unprocessed / confirmation requested / warned-unconfirmed / no-show / confirmed / confirmed late), entirely orthogonal to whether the session was cancelled as a bookable slot. The only real cancellation signal in legacy is the `CANCELLED_SESSION` sentinel model. Every migrated session is `'Scheduled'` unless its `modelId` is that sentinel, in which case `'Canceled'` — `status` itself plays no role. (An earlier draft of this script defaulted every non-`10` status code to `'Canceled'`, which would have wrongly cancelled 220 real sessions; fixed before that ever ran against real target data.) |
| `session_type` | `sessions.typeId` → `session_types` | see §6 below |
| `description` | `session_alt_descriptions`, if present for that session, else blank; a `[Legacy record: model did not show up for this session.]` note is appended when `status = 4` (`MODEL_NO_SHOW`, confirmed meaning per the Appendix — 0 rows in this dump, but preserved for completeness) | legacy content is raw HTML (`<STRONG>`, `<I>`, `<BR>`) — needs conversion to plain text/markdown, not a direct copy (this app's rendering conventions avoid raw HTML — see CLAUDE.md's CMS notes) |
| `start_time`/`end_time` | `sessions.date` + the session's `session_times` row (real time, not slot-bucketed — see `LegacyDataAnalysis.md` Decision 3) | |
| `max_capacity` | `session_seating_capacity_exceptions`, if an override applies to that session, else the default (25, matching legacy's own documented default) | |
| `host_user_id` | `sessions.mgrId` or the applicable `session_alt_managers` override → migrated `users.id` | |
| `is_ticketed` | — | no direct legacy equivalent column; default `true` for all migrated sessions unless a specific session's `modelId` was the `MODEL_NOT_YET_BOOKED`/`CANCELLED_SESSION` sentinel, which never had real registrations anyway |

Sessions whose `modelId` is one of the two sentinel values (74/100) still migrate as `sessions` rows (they're real calendar placeholders), just with `NULL` in place of a `models` FK rather than pointing at a migrated sentinel model row (the sentinels themselves are excluded from `models`, per the mapping above).

### `legacy_attendance_history` ← `seat_registrations` (25,725 rows, past-dated per §4)

Populated per §3.4's shape. **Deliberately not synthesized into `passes`/`transactions`** — reconstructing a real per-row `effective_price` for 25,725 individual historical registrations (vs. the much smaller, currently-relevant `numTickets` balance) would require the same weighted-average guesswork at far larger scale, for records with no ongoing financial consequence, and — more importantly — would inject 25K rows of estimated pricing directly into the same tables `/ops/financials` and `/admin/dashboard` treat as ground truth for revenue reporting, silently distorting historical financial totals with guessed numbers presented as if they were real Stripe/PayPal charges. A dedicated table keeps this data queryable (joinable against migrated `sessions`/`users`/`models` for "who attended session X" style questions — satisfying `LegacyDataAnalysis.md` Decision 4) without that contamination risk.

## **6. Session Type Mapping**

Resolved directly with the org (this app's `session_type` codes have no documented labels anywhere in the codebase — confirmed by search):

| Legacy `session_types` | New `session_type` code | Notes |
|---|---|---|
| gesture | `G` | |
| regular | `R` | |
| portrait | `P` | |
| long pose | `L` | |
| special | `S` | also currently absorbs costume (below) |
| costume | `S` | no dedicated code exists yet; org may add a `C` code later — not needed for this migration |
| multiday pose | `X` | `X` = "ELP" (Extra Long Pose) in this app's own convention — a strong conceptual match for legacy's "same model repeating the same pose for two or more sessions" |
| empty (`UNDEF` placeholder) | — | not a real session type; sessions using it as a placeholder don't migrate a `session_type` value derived from it (fall back to whatever the session's actual type field indicates, or flag for manual review if genuinely ambiguous) |
| *(no legacy equivalent)* | `Gallery`, `Party` | newer additions to this app; nothing migrates into these |

## **7. Password Migration**

**Resolved.** The legacy hash format is bcrypt (`$2y$`, 60 characters — confirmed directly against the dump, format/length only), which this stack can verify. Per the original plan's own first option: migrate the hash as-is into `users.password_hash`, and let the login path verify against it and transparently re-hash to argon2id (`SecurityDocument.md` §2) on next successful login. **This requires the Credentials provider's `authorize()` (`src/auth.ts`) to support verifying a legacy bcrypt hash on a migrated account's first post-cutover login** — real application code, not just a migration-script concern — flagged as prerequisite work alongside §3.

The 2 `session_attendees` rows with a 1-character `x` `PasswordHash` (almost certainly disabled/locked legacy accounts, not real hashes) get a random, unusable placeholder hash instead, and should be force-reset regardless of their `users.status` outcome — a locked-out legacy account has no real password to preserve.

## **8. Phases**

1. **Schema mapping** — *substantially complete*, see §5 above; remaining gaps are the explicitly-flagged manual-review items (`owned_passes` `passKind=0` miscellaneous rows, whether role passes also grant seat allowances, the 24 generic-`volunteer_status` rows). `board_status` and both undocumented enums (`sessions.status`, `registration_logs.what`) are fully resolved (§5, `LegacyDataAnalysis.md` Appendix).
2. **Schema prerequisites** *(done)*. `users.display_name`/`users.legacy_id`, the registration-flow update, the `legacy_attendance_history` table, `volunteer_role_name`'s `Board` value, and bcrypt-verification support in `authorize()` are all implemented and committed.
3. **Data cleaning & normalization.** Resolve the 2 duplicate `merdels` emails; resolve the 3 `passKind=0` miscellaneous `owned_passes` rows; resolve the 24 generic-`volunteer_status` rows (§5); reconcile any orphaned records surfaced during script development (none were found — every foreign key the scripts touch resolved cleanly against real data, verified by 0-warning runs on every FK lookup except the intentionally-flagged manual-review cases above).
4. **Trial import into staging** *(scripts built and locally rehearsed; not yet run against a real `staging` environment)*. `scripts/migrate-legacy-data.ts` (`pnpm migrate-legacy-data`) reads from `LEGACY_MYSQL_URL` and writes to `DATABASE_URL`, transactionally — nothing commits unless every step succeeds. Rehearsal so far has been against an ephemeral, throwaway MySQL container (the dump) and a throwaway Postgres database (never the real dev/staging/production DB), with every migrated table's row count independently verified against direct `COUNT(*)` queries on the source. Two flags support repeated rehearsal: `--reset` (truncates every destination table first — refuses to run without it if `users.legacy_id` data already exists, as a guard against double-migrating into a real target) and `--cutover-date=YYYY-MM-DD` (only for reproducing a fixed future-vs-historical split against a dump whose own creation date has since fallen into the past — a real run always uses the actual moment it executes, per §4).
5. **Reconciliation & validation** (see §9).
6. **Cutover.** A defined freeze window on the legacy system's *member/booking/transaction* data (the model-request portion keeps running throughout, per §1). Take a final delta export, import it, validate again, then flip the new system to authoritative for members/bookings/transactions. **The future-vs-historical date split (§4) is computed relative to this actual cutover date, not any date fixed during planning.**
7. **Rollback plan.** If post-cutover validation fails, the legacy system's member/booking/transaction data remains untouched (migration is read-only against the source), so rollback means reverting to the legacy system as authoritative and re-running cutover after fixing the identified issue — not a destructive recovery.

## **9. Validation**

Because transactions and audit history are financially sensitive, validation goes beyond row counts:
* Row-count reconciliation per table between source dump and imported data — including the future-vs-historical split counts (§4), which should be spot-checked against a fresh query at actual cutover time, not assumed to match the 38/57 counts observed during this analysis (which were relative to the dump's 2026-05-24 creation date, not the real cutover date).
* Spot-checks against legacy-side reports (if the legacy system can produce a membership roster or revenue report, compare its totals against the imported data's totals).
* Financial totals reconciliation: sum of migrated `transactions.amount_paid` should match whatever financial summary the organization's treasurer already has for the relevant period — this is the most important check before cutover. **Verify the PayPal-era marker (§5's `transactions` mapping) correctly excludes legacy transactions from any Stripe-specific fee/reconciliation logic** (`/ops/financials`'s payout-batch reconciliation, in particular, has no PayPal equivalent to reconcile against).
* Spent vs. unused pass balances reconciled against `numTickets` (weighted-average-converted) and `owned_passes` (membership-derived) for a sample of members, since an incorrect migrated balance directly affects a member's ability to book sessions post-cutover.
* The 1 currently-suspended account (§2) is confirmed to land as `Suspended`/`Banned`, not silently dropped — the compliance-sensitive check called out in `LegacyDataAnalysis.md`.
