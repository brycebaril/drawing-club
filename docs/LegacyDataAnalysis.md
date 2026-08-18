# Legacy Data Analysis

Analysis of `legacy_data/robo_backup_20260524.sql`, a MySQL dump of the current Robostrar/Robobooker system used by the Vancouver Life Drawing Society (DBA Basic Inquiry), performed to unblock `MigrationPlan.md` §3. This document is schema- and aggregate-statistics-only — no individual row content (names, emails, phone numbers, password hashes) appears anywhere below, per this analysis's own PII-handling constraint. The dump was imported into an ephemeral, throwaway `mysql:8` Docker container (never added to this repo's `docker-compose.yml`, never touching the app's real Postgres database) to run real SQL rather than reading 34MB of dump text; the container was torn down after this analysis.

## Key structural findings

1. **`AUTO_INCREMENT` is not a reliable proxy for row count.** It reflects the highest id ever issued, not current row count — deleted rows silently deflate the gap. This mattered concretely for `suspended_attendee_accounts`: its `AUTO_INCREMENT` value (834) suggested ~834 rows: the real count is **1**. Every count in this document is a verified `COUNT(*)`, not an `AUTO_INCREMENT` or `information_schema.tables` estimate (the latter is also just an estimate for InnoDB tables and was independently caught understating `virtual_sessions`/`virtual_session_registrations`/`robostate`/`session_registrars` as 0 rows when their real counts are 21/628/1/1).

2. **`suspended_attendee_accounts` is current-state, not an audit log.** Its own schema comment is explicit: *"Add rows to suspend accounts; remove rows to return previously suspended accounts to normal."* Only 1 account is suspended right now; the other ~833 historical suspend/unsuspend events left no trace in this table. `registration_logs.what` (the event-log enum) only documents codes 0–5 (login/logout/seat-registration events) — no suspend/unsuspend code exists among them. **This is an unrecoverable historical gap in the legacy system itself**, not something a smarter query can find — flagged as a finding, not an open question.

3. **`owned_passes` does not correspond to this app's `passes` table.** Cross-referencing `owned_passes.passKind` against its own `passName` text and the `entitlements` lookup table shows `owned_passes` is entirely a **membership/role** concept (Annual Society Membership: 705 rows; Board/volunteer/committee role passes: 47 rows; Session Manager passes: 21 rows) — never a drawing-session credit. The `entitlements` it grants (`member_status`, `volunteer_status`, `manager_status`, `board_status`, `model_booker`, etc.) map cleanly to this app's role system (`MBR`, volunteer sub-roles), not to its pass/currency system.

4. **Drop-in session-ticket purchases never created a durable per-pass row at all.** `store_order_components` shows the actual sold products: single tickets, 5-packs, and 10-packs (member/non-member priced) — **none of them link to `owned_passes`** (`with_pass_link = 0` for every one of those SKUs; only membership SKUs 500/501/502 link to a pass). Instead, `session_attendees.numTickets` is a **single running-balance integer** with no per-purchase price or date lineage, and `seat_registrations.passId IS NULL` is the system's own documented signal for "this seat was paid for out of the ticket balance, not a membership pass." This app's `passes` table requires a distinct `effective_price` per pass — the legacy data has no way to reconstruct that per-ticket for a user's current balance; see Open Questions.

5. **Two of the "31 tables" already had zero live application meaning before touching row counts at all**: a stray `SCRATCHCONSORTIUM LIVE PRODUCTION` table (0 rows, a single auto-increment `id` column, no real schema — almost certainly a deploy-time environment sentinel, not app data) sits alongside the 31 real tables and is excluded from the mapping matrix below; and `merdels` (models) contains two synthetic sentinel rows (`id=74` "CANCELLED SESSION", `id=100` "model not yet booked") used as placeholder values in `sessions.modelId` rather than real models — excluded from the ~147 real model rows referenced below.

6. **Referential integrity is clean.** Zero orphaned foreign keys found across every relationship checked (`seat_registrations`→session/attendee, `owned_passes`→owner, `sessions`→model, `store_orders`→customer). No null/empty emails or password hashes among `session_attendees`. Two duplicate `merdels` (model) email addresses were found — a minor data-quality flag, not a blocker.

7. **`session_attendees` has no account-creation timestamp column at all** — only `id`, `numTickets`, name fields, `email`, `notes`, `PasswordHash`, `mailList`. There is no legacy equivalent of this app's `users.created_at` to carry forward.

## Compliance-sensitive callout

**`suspended_attendee_accounts`: exactly 1 row, referencing a real `session_attendees.id`.** This must become a real `users.status = 'Suspended'`/`'Banned'` row in the migration — a suspension that silently doesn't carry over is a moderation regression, not just a data-modeling simplification. Per finding #2 above, the other ~833 historical suspensions cannot be recovered or migrated; the migration can only carry forward what's true *right now*.

## Data quality summary

| Check | Result |
|---|---|
| Duplicate `session_attendees.email` | 0 |
| Duplicate `merdels.EMail` (models) | 2 — flag, not blocking |
| Null/empty `session_attendees.email` | 0 |
| Null/empty `session_attendees.PasswordHash` | 0 |
| Orphaned `seat_registrations` → session | 0 |
| Orphaned `seat_registrations` → attendee | 0 |
| Orphaned `owned_passes` → owner | 0 |
| Orphaned `sessions` → model | 0 |
| Orphaned `store_orders` → customer | 0 |
| `session_attendees` with `numTickets > 0` | 1,120 of 4,185 (~27%) |
| Undocumented `registration_logs.what` codes present in data | 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18 (only 0–5 are documented in-schema) |

## Mapping matrix (31 tables)

Legend — **Migrate**: real ongoing data, needs a home in the new schema. **Transform**: real data, but shape differs enough from the target that it needs a non-trivial mapping (see notes). **Archive-only**: historically real, but the new app has no live concept for it — export for reference, don't import. **Skip**: no migration value (empty, defunct, or superseded by a mechanism this app already has).

| Legacy table | Rows | App equivalent | Verdict | Notes |
|---|---|---|---|---|
| `session_attendees` | 4,185 | `users` | Migrate | Core identity fields (name/email/password hash) map directly. No `created_at` exists to carry over (finding #7). `numTickets` doesn't map directly — see Open Questions. |
| `merdels` | 149 (147 real + 2 sentinels) | `models` | Migrate | Exclude sentinel ids 74/100. 2 duplicate emails to resolve first. |
| `sessions` | 2,406 | `sessions` | Transform | `status` is undocumented (see Open Questions). `modelId` sentinel values (74/100) need special-case handling, not literal FK migration. |
| `session_types` | 8 | `SESSION_TYPES` (app constant) | Transform | Legacy taxonomy (gesture/regular/costume/portrait/long pose/multiday/special/placeholder) is richer than this app's current type set — needs reconciling, not a 1:1 copy. |
| `session_times` | 23 | recurring-session start/end times | Migrate | **Resolved 2026-08-18**: no data loss. `SLOT_TIMES`'s 3 canonical slots are only a checkbox-grid convenience for the multi-week-series picker and a rendering bucket for the schedule grid — ordinary recurring rules (`recurrence_rules.start_time_of_day`, confirmed via `RecurrenceRuleForm.tsx`'s plain `type="time"` input) already carry arbitrary real times with no 3-slot restriction. Each of the 23 legacy weekly slots' real start/end time carries straight into migrated `sessions.start_time`/`end_time` unchanged. |
| `session_general_schedule` | 14 | `recurrence_rules` (conceptually) | Archive-only | Legacy's "template + open/closed booking window" model is richer than this app's rule model (can express future-planned reopenings). Recommend admins manually recreate active recurring rules rather than auto-migrating this table. |
| `session_alt_managers` | 15 | `sessions.host_user_id` overrides | Archive-only | Use only to backfill historical host assignment during transform; no standing table equivalent needed going forward. |
| `session_alt_descriptions` | 18 | `sessions.description` (per-instance) | Transform | Legacy content is raw HTML (`<STRONG>`, `<I>`, `<BR>`); this app's rendering conventions (see CLAUDE.md's CMS/session-notes notes) favor plain text/markdown, not raw HTML — needs conversion, not copy. |
| `session_notifications` | 198 | `waitlist_entries` | Skip | Structurally equivalent, but entries reference long-past sessions — no ongoing value once a session has passed. Only entries against still-open future sessions would be worth migrating, and none exist as of the dump date. |
| `session_seating_capacity_exceptions` | 7 | per-session `max_capacity` | Transform | No standing "exceptions" table in this app — apply directly as a capacity value on any migrated future/upcoming session it still affects. |
| `session_registrars` | 1 | — | Skip | Single internal config pointer (an attendee id), no equivalent concept. |
| `nonsession_events` | 11 | CMS `news_posts` (conceptually) | Skip | Announcement banners interspersed in the legacy schedule list; if any are still current, recreate manually as News posts — not a schema-level migration target. |
| `google_cal_postings` | 2,411 | — | Skip | Google Calendar sync bookkeeping; this app has no Google Calendar integration. |
| `google_cal_unbooked_postings` | 0 | — | Skip | Empty. |
| `stashed_params` | 10,612 | this app's own token mechanisms | Skip | Ephemeral email-verification/action tokens; entirely transient, zero long-term value. |
| `robostate` | 1 | — | Skip | Single-row internal script-coordination state (a lock flag + last-run date for an internal ticket-distribution script). Not app data. |
| `virtual_sessions` | 21 | — | Archive-only | Entirely bounded to 2021-03-21–2021-08-22 (a COVID-era pilot, "ROBOFAR" — confirmed genuinely defunct, exactly as its own schema comment predicted in 2021). Real historical data, but no live feature to receive it. |
| `virtual_session_registrations` | 628 | — | Archive-only | Registrations for the above; same disposition. |
| `virtual_session_maillist` | 206 | — | Archive-only (possible outreach value) | A mailing-list signup for the defunct virtual-session feature. No schema-migration value, but the org may want the raw email list for outreach — that's a marketing decision outside this migration, not a database concern. |
| `owned_passes` | 775 | `membership_history` + `volunteer_roles` (split) | Transform | See finding #3. ~705 rows → membership history; ~68 rows → volunteer role assignments; ~3 miscellaneous rows (test/one-off passes) need manual review. `session_attendees.numTickets` (the separate ticket-balance integer, not this table) additionally synthesizes new `passes` rows — see Decision 1 below. |
| `owned_entitlements` | 887 | (informs the `owned_passes` transform) | Transform | Junction table; its `entitlement_id` is what determines which of membership/volunteer-role each `owned_passes` row becomes. |
| `entitlements` | 10 | (reference only) | Skip | Lookup table; used only to design the transform above, not migrated as a live table itself. |
| `suspended_attendee_accounts` | 1 | `users.status` | Migrate | See Compliance-sensitive callout above. |
| `store_orders` | 10,339 | `transactions` | Transform | `status` is actually documented (0=unpaid, 10=fulfilled — confirmed no other codes appear in the data). Only the 9,196 fulfilled orders represent real historical purchases; the 1,143 unpaid/abandoned orders are archive-only. `paidBy` (cardholder name, collected post-1/2024) should never be migrated — this app doesn't store cardholder data either, consistent with its existing PCI-scope discipline. `processor` is PayPal-only; this app uses Stripe, so there's no live `gateway_ref_id` equivalent for these historical rows. |
| `store_order_components` | 10,440 | `transactions` line items | Transform | This is the actual source for reconstructing what each historical order contained (ticket singles/packs vs. membership) — required input to both the `store_orders` transform and the `owned_passes`/ticket-balance transform. |
| `seat_registrations` | 25,725 | new `historical_bookings`-style table | Migrate | **Resolved 2026-08-18**: the user wants both to look back on this data *and* confirm the live schema can answer the same kinds of questions going forward. Needs a new table in this app's own Postgres schema (added via a real migration, not an external CSV/warehouse) populated once from these 25,725 rows during cutover. Live tables (`passes`, `seat_reservations`, `sessions`) already retain post-cutover bookings indefinitely (nothing purges them today), so ongoing query parity should hold without further schema work — worth confirming explicitly when `MigrationPlan.md` designs this table's shape. |
| `requested_bookings` | 2,736 | — | Skip | This is literally "the separate legacy system" this app's Model Booker workspace was deliberately designed to bridge to manually (per this app's Phase-1 "model assignment is decoupled" decision) — not a queue meant to be inherited wholesale into the new app. |
| `outmail` | 16,918 | — | Archive-only | Historical email send log; this app has no persistent outbox table (SES + CloudWatch cover delivery tracking instead). Customer-service reference value only. |
| `email_templates` | 12 | this app's hardcoded email copy (`src/lib/email/*`) | Reference only | Worth a manual side-by-side read for content parity, not a schema migration target — this app has no admin-editable email-template system. |
| `SCRATCHCONSORTIUM LIVE PRODUCTION` | 0 | — | Skip | Environment-marker artifact, not app data (see finding #5). |

## Decisions (resolved 2026-08-18)

1. **`session_attendees.numTickets` → individual `passes` rows.** **Decided: weighted-average price per user.** For each user, compute their average price paid per ticket across their full `store_order_components` purchase history (all single/5-pack/10-pack SKUs, member and non-member priced), then synthesize N pass rows at that average `effective_price`, where N = their current `numTickets`. Chosen over FIFO-from-most-recent-order (arbitrary when a user bought multiple pack sizes over time) and over a $0 lump-sum migration pass (throws away real yield/ROI accuracy) — this is the most defensible accuracy without guessing which specific historical purchase the remaining tickets came from.
2. **`sessions.status`, `sessions.modelId` sentinels, and `registration_logs.what` codes 6–16/18 — no schema documentation, no legacy app source available during analysis.** **Decided: query the org's former Robostrar admin, non-blocking.** A specific written query for them is in the Appendix below. This does **not** block `MigrationPlan.md` from proceeding — these are narrow, isolated lookup-table questions (a session-status enum and an event-log code table) that don't ripple into the rest of the schema design. In the interim, `MigrationPlan.md` should use the best-guess correlations already explored (e.g. `status=10` covers ~83% of rows across the full date range, suggesting "normal/completed") as provisional mappings, clearly flagged as inferred, and swap in confirmed values once the admin responds.
3. **`session_times`'s 23 distinct weekly slots vs. this app's 3 fixed daily slots.** **Resolved as a non-issue, not a tradeoff** — see the updated `session_times` mapping-matrix row above. The app's 3 canonical slots only govern the multi-week-series checkbox picker and the schedule grid's display columns; ordinary recurring rules already store arbitrary real start/end times (confirmed live in the app today — e.g. two distinct existing evening rules at 6–9pm and 7–10pm). Legacy's real per-slot times migrate directly into `sessions.start_time`/`end_time` with no consolidation or loss.
4. **Historical attendance (`seat_registrations`, 25,725 rows).** **Decided: migrate into a new table in this app's live schema**, not a CSV export — see the updated `seat_registrations` mapping-matrix row above. The user wants both to look back on legacy history and to confirm the live app can answer equivalent queries going forward; `MigrationPlan.md` should design this table's shape explicitly (fields needed for "who attended session X" style queries) rather than treating it as an afterthought.
5. **`virtual_session_maillist` (206 emails).** **Decided: skip entirely**, along with the rest of the defunct virtual-session data (2021, COVID-era, confirmed inactive since — see Finding above). No outreach export requested.

## Appendix: query for the former Robostrar admin

Non-blocking — send whenever convenient; `MigrationPlan.md` proceeds with provisional mappings in the meantime (see Decision 2).

> Hi [Name],
>
> We're migrating off Robostrar and I'm trying to pin down a few internal codes that aren't documented anywhere in the database itself. No rush on this — we can keep moving without it — but it'd help make the migration cleaner if you remember any of these.
>
> **1. Session status codes.** Every session in the old system has a numeric "status." Looking at the data, I see 5 distinct values:
> - Code 0: 194 sessions, spread across the full history (2020–2026)
> - Code 1: only 2 sessions, both in a narrow window in March 2020
> - Code 3: 129 sessions, spread across the full history
> - Code 10: 1,991 sessions — the large majority, spread across the full history
> - Code 11: 90 sessions, spread across the full history
>
> In the Robostrar admin, what different states could a session be in (e.g. draft/tentative, confirmed, canceled, closed, completed, archived)? It doesn't need to map to these exact numbers — just a description of the possible states is enough, I can likely match them up myself.
>
> **2. Event log codes.** There's a log of "what happened" events (logins, bookings, cancellations) with codes 0–5 already documented in the schema (login, logout, self-register a seat, self-cancel a seat, admin-register a seat for someone else, admin-cancel a seat for someone else). But the actual data also has codes 6 through 16, plus 18, that were never documented. The three most common undocumented ones are:
> - Code 6: ~10,300 occurrences
> - Code 7: ~9,200 occurrences
> - Code 8: ~12,900 occurrences
>
> Given how common these are (a similar magnitude to our ~10,400 order records), my best guess is they're related to the purchase/checkout flow (something like "order created," "order paid," "pass delivered") — does that sound right? And do you recall what the less common codes (9, 10, 11, 12, 13, 14, 15, 16, 18) might have logged? Even a partial answer is useful — for anything you don't remember we'll just fall back to a conservative default.
>
> Thanks — this is genuinely optional/non-blocking, just trying to get it as accurate as possible.

## Recommended next steps

This document satisfies `MigrationPlan.md` §3's stated blocker ("get the legacy schema/dump"), and all five open questions are now resolved (Decision 2 pending external, non-blocking confirmation). The natural next step is to fold the mapping-matrix verdicts and the decisions above into `MigrationPlan.md` itself — that document's job is the actual one-time cutover, which this analysis deliberately stopped short of.
