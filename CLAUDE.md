# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Phase 1 (repo scaffold, schema, local dev, CI) and Phase 2 (auth + RBAC) are done. Real feature routes (schedule, wallet, ops, admin) haven't been built yet — only a placeholder `/dashboard`.

**Stack:** TypeScript / Next.js (App Router), pnpm, PostgreSQL via raw SQL (`pg`, no ORM — see `ArchitectureDocument.md` §2), `node-pg-migrate` for schema migrations, Auth.js v5 (`next-auth@beta`, Credentials provider, JWT sessions), Stripe (not yet integrated), hosted on AWS via Amplify Hosting (not yet provisioned).

**Commands:** `docker compose up -d` (local Postgres) → `pnpm install` → `pnpm migrate` → `pnpm seed` → `pnpm dev`. Also: `pnpm lint`, `pnpm typecheck`, `pnpm test` (Vitest), `pnpm test:e2e` (Playwright), `pnpm migrate:create <name>` (new migration).

**Auth/RBAC implementation notes** (see `src/auth.ts`, `src/proxy.ts`, `src/lib/auth/*`):
- RBAC is enforced in `src/proxy.ts` — Next.js **renamed "Middleware" to "Proxy" in v16**; same mechanism, new file/export name (`export default` in `proxy.ts`, not `middleware.ts`). Docs still say "middleware" in places since that's the conceptual role — don't recreate a `middleware.ts` file if you see the old name.
- Proxy defaults to the **Node.js runtime** in Next 16 (no opt-in, and setting a `runtime` export in a Proxy file throws). This is what lets `src/proxy.ts` query Postgres directly on every request for fresh status/role checks instead of trusting cached JWT claims.
- Auth.js Credentials provider only supports **JWT session strategy** (not database sessions) — consistent with no-ORM anyway, since DB sessions need an adapter.
- MFA is a two-step client flow: `POST /api/auth/check-credentials` validates password and reports whether a TOTP step is needed, *before* the real `signIn()` call — Auth.js's `authorize()` can't express "need more info" on its own, so don't try to collapse this into one step.
- `/api/*` is entirely excluded from `src/proxy.ts`'s matcher — API routes need their own auth handling (JSON 401s, bearer tokens), not an HTML-login-page redirect.

## What this project is

A scheduling and membership platform for a life drawing society, replacing ad hoc tools with a single system that serves three audiences: the public, paying members booking sessions, and the volunteers/admins who run the studio. The full spec lives in five docs — read the relevant ones before designing or implementing anything, since the data model, access rules, and engineering decisions are intentionally detailed and easy to get subtly wrong from memory:

- `docs/DesignDocument.md` — UI/UX behavior, roles & permissions, the pass/booking economy, payments, and draft data models (source of truth for business logic).
- `docs/SiteOutline.md` — route map, per-route RBAC visibility, and modal/deep-linking architecture (source of truth for navigation and access control).
- `docs/ArchitectureDocument.md` — stack, AWS infrastructure, environments/CI-CD, payments integration, testing strategy (source of truth for how the system is built and run).
- `docs/SecurityDocument.md` — auth/session security, RBAC enforcement pattern, secrets management, PCI scope, GDPR/compliance posture (source of truth for security requirements).
- `docs/MigrationPlan.md` — scope and phases for the one-time legacy data cutover; currently blocked pending a legacy DB dump/schema (see its §3).

## Core domain concepts

These rules recur throughout the spec and are easy to violate accidentally when implementing a feature in isolation:

- **Passes are the booking currency**, not direct payment. Standard passes are non-transferable and bind to a user; transferable passes must be explicitly assigned to a user before they can be spent. Every pass records an `effective_price` at creation time (even $0.00 for comp/volunteer passes) for yield/ROI accounting — never leave this null.
- **Cancellation is time-gated**: passes only return to a user's balance if canceled before `CANCELLATION_CUTOFF_HOURS` (default 24h) prior to session start. After the cutoff, booking state is locked (UI shows a lock icon; the cancel action must be disabled, not just hidden).
- **Booking windows differ by tier**: Account Holders see/book a shorter forward window than active Paid Members (`BOOKING_WINDOW_ACCOUNT_DAYS` vs `BOOKING_WINDOW_MEMBER_DAYS`). "Paid Member" is a derived status from membership history (`valid_from`/`valid_until`), not a stored role flag — check current membership validity, don't cache tier on the user record.
- **Multi-week series use numbered seats**, not general admission. A user can book a subset of dates in a series for the same seat; the remaining dates for that seat stay open to others. Pass deduction is per-date-booked, not per-seat.
- **Waitlist is a notification list, not a queue.** A cancellation triggers a broadcast email to everyone waitlisted; the freed spot is first-come-first-served. Don't implement auto-promotion of the "next" waitlisted user.
- **Config is data, not constants.** Pricing, cutoffs, booking windows, capacity defaults, and payout rates live in an admin-editable settings store (Section 12.1 of the design doc), each change audit-logged with old/new value. Changing a price must never retroactively alter historical transactions or already-spent pass values.
- **All state-changing admin/volunteer actions are audit-logged** (refunds, manual pass grants, bans, membership adjustments, setting changes) — this is a first-class requirement, not incidental logging.
- **Model assignment is decoupled in Phase 1**: models request sessions through a separate legacy system; the Model Booker volunteer manually mirrors assignments into this app. Don't design model-facing self-service booking yet — that's explicitly out of scope until Phase 2 (see Section 14, Open Questions).
- **Recurring sessions vs. multi-week series are different concepts** — don't conflate them. `series_id` links a session to a Section 6.5 numbered-seat multi-week series (e.g. a 4-week Extra Long Pose); `recurrence_rule_id` links it to a Section 9.2 indefinitely-repeating recurring session (e.g. "every Monday evening"). A session has at most one of the two, never both.
- **Editing/canceling a recurring occurrence is a three-way choice**: this occurrence only, this-and-future (splits the recurrence rule via `superseded_by_rule_id`), or the entire series. Past instances are never touched by a rule-level edit.
- **Passes never expire**; standard/transferable passes stay in a balance until spent, refunded, or admin-revoked. Don't add expiration logic unless this changes.
- **Booking/purchasing requires a verified email** (`email_verified_at` on Users) — enforce this server-side on the mutation, not just as a registration-flow UI gate.
- **No sales tax handling** — listed prices are final; this is a documented assumption (Design Doc §7.1), not an oversight.

## Roles & access

Eight access levels gate the route tree: `GUEST`, `ACCT`, `MBR`, `VOL_HOST`, `VOL_MKT`, `VOL_MBR`, `VOL_CTRL`, `ADMIN`. Volunteer sub-roles are additive on top of a base account, not separate account types — a user can be `MBR` + `VOL_HOST` simultaneously. Volunteer sub-roles are also **not mutually exclusive with each other** — a user can hold multiple at once (e.g. `VOL_HOST` + `VOL_MKT`), stored as multiple rows in `Volunteer_Roles` rather than a single-value field; route access is granted if *any* held role permits it. `SiteOutline.md` §4 has the full route-by-role access matrix; consult it directly rather than re-deriving visibility rules when adding a page. `ADMIN` and `VOL_CTRL` accounts require MFA to log in.

Route zones map to three areas: `/`, `/about`, `/schedule`, `/news`, `/contact`, `/auth/*` (public), `/dashboard` + `/app/*` (any authenticated member), `/ops/*` (specific volunteer roles) and `/admin/*` (admin-only). Several member interactions are modal states mirrored into query params (e.g. `/app/schedule?session_id=:uuid`) rather than separate routes — see `SiteOutline.md` §5.1 for the deep-linking convention to preserve when adding new modals.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
