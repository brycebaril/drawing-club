# **Architecture Document: Life Drawing Society Scheduling System**

## **1. Overview**

This document specifies how the system described in `DesignDocument.md` and `SiteOutline.md` is actually built, deployed, and operated. It assumes familiarity with both — section references below (e.g. "Design Doc §7.3") point back to the business rules that drove each engineering decision rather than repeating them.

## **2. Stack & Application Topology**

* **Language:** TypeScript, end to end (server and client).
* **Framework:** Next.js (App Router), run as a single full-stack application rather than a separate API + SPA. One app serves the public SSR pages (`/`, `/about`, `/schedule`, `/news`, `/contact`), the authenticated member portal (`/dashboard`, `/app/*`), the volunteer workspaces (`/ops/*`), and the admin portal (`/admin/*`) — matching the route/RBAC structure in `SiteOutline.md` §3–4.
* **Database:** PostgreSQL. Chosen over MySQL because the draft schema (Design Doc §13) leans on UUID primary keys, enum columns, and JSON metadata (e.g. `System_Audit_Logs.metadata`), all of which Postgres handles natively.
* **ORM / migrations:** No ORM. Queries are raw SQL via `node-postgres` (`pg`), hand-written per call site rather than generated from a schema or built through a query-builder abstraction. Migrations are handled separately by `node-pg-migrate` — a migration *runner* only (applies ordered SQL files, tracks what's applied in the database), not a query or entity layer, so it doesn't reintroduce ORM-style abstraction through the back door.
* **Auth:** Auth.js (NextAuth) using the Credentials provider, JWT session strategy (required for Credentials — database sessions would need an ORM adapter we deliberately don't have). This satisfies Design Doc §5.1's requirement that the system manage its own accounts and store hashed credentials directly — Auth.js supplies session/cookie/CSRF plumbing on top of that, it does not delegate identity to a third party. Full security requirements are in `SecurityDocument.md`.
* **RBAC enforcement:** `src/proxy.ts` (Next.js's Proxy convention — the renamed successor to "Middleware" as of Next 16, same mechanism). Proxy defaults to the Node.js runtime in Next 16, so it queries Postgres directly on every request to resolve roles and account status fresh rather than trusting cached JWT claims — see `SecurityDocument.md` §3.

## **3. AWS Infrastructure**

| Concern | Service | Notes |
| :---- | :---- | :---- |
| App hosting | **AWS Amplify Hosting** | Native Next.js SSR/API-route support; git-based build-on-push is Amplify's built-in CI/CD, so no separate pipeline tool is needed. |
| Database | **RDS for PostgreSQL** | Automated backups with a defined retention window (e.g. 7 days) and point-in-time recovery enabled; also the target for the eventual legacy data cutover import (see `MigrationPlan.md`). |
| Connection pooling | **RDS Proxy** | Amplify's Next.js compute can scale out under load; without a pooler, many short-lived server-side connections can exhaust Postgres's `max_connections`. RDS Proxy sits in front of RDS so the app doesn't manage pooling itself. |
| File/image storage | **S3** | CMS-uploaded images (news posts, static pages, Design Doc §8), user-uploaded assets if any are added later. |
| Transactional email | **Amazon SES** | Waitlist alerts (Design Doc §6.4), receipts, pass-claim links (Site Outline §3.2 `/app/wallet/claim`), password reset, email verification (Design Doc §5.1). SES starts in a sending sandbox (low volume, verified recipients only) until AWS grants production access — factor the approval lead time into launch planning. |
| Secrets | **AWS Secrets Manager** | DB credentials, Stripe secret key, NextAuth secret, SES credentials. Not stored as plaintext Amplify environment variables — see `SecurityDocument.md` §Secrets Management. |

## **4. Environments**

Three environments, mapped to Amplify branch deploys:

* **dev** — tracks a development branch, ephemeral/disposable data.
* **staging** — pre-production; this is the rehearsal target for the legacy data migration import described in `MigrationPlan.md` before any production cutover. Any data seeded here from production (post-launch) must be anonymized first — see `SecurityDocument.md` §6 on the GDPR-relevant handling of member data.
* **prod** — the production branch; deploys require passing CI checks (type-check, lint, test suite) before merge.

## **5. Local Development**

* **Database:** PostgreSQL via Docker Compose. Every developer runs `docker compose up` to get a local Postgres instance matching the production major version, rather than depending on a cloud database for day-to-day work. A `docker-compose.yml` at the repo root defines the `db` service; the app's `DATABASE_URL` in local `.env` points at it.
* **Environment variables:** an `.env.example` in the repo documents every variable the app needs (`DATABASE_URL`, `NEXTAUTH_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, SES/S3 config, etc.) with placeholder values; real local `.env` files are gitignored. Locally, secrets are just `.env` values — Secrets Manager (§3) is a production/staging concern only.
* **Seed data:** a seed script creates one account per role (GUEST needs none, but ACCT/MBR/each VOL\_\* combination/ADMIN), a handful of sessions across all four creation patterns (Design Doc §9.2) including a multi-week series with partially-booked seats, some spent/unspent/transferable passes, and a full session to exercise the waitlist. This is the same script used to reset the `staging` environment between migration rehearsals (`MigrationPlan.md` §4).
* **Payments:** Stripe test mode keys for local `.env`; the Stripe CLI (`stripe listen --forward-to localhost:3000/api/webhooks/stripe`) forwards webhook events to the local dev server, since Stripe can't reach `localhost` directly. This is how the checkout → webhook → `Transactions` write flow (§7) gets exercised end-to-end without deploying anywhere.
* **Running the app:** standard `next dev`; no Amplify-specific tooling is needed locally since Amplify Hosting only matters at deploy time.
* **Node version:** pinned via `.nvmrc` / `engines` in `package.json` to whatever LTS version Amplify's build image supports, so local and CI/deploy environments can't drift apart.

## **6. CI/CD**

Amplify Hosting's built-in git-based pipeline builds and deploys on push to a tracked branch — this removes the need for a separate CodePipeline/GitHub Actions deployment pipeline. GitHub Actions (or equivalent) should still run pre-merge checks (type-check, unit/integration tests, dependency vulnerability scan — see `SecurityDocument.md`) as required status checks on pull requests targeting the production branch, independent of Amplify's deploy step.

## **7. Payments Integration**

* **Gateway:** Stripe, chosen because its webhook/payout model maps directly onto the reconciliation requirements in Design Doc §7.3 (processing fees, gross/net amounts, `payout_batch_id`).
* **Card entry:** Stripe Checkout or Stripe Elements — card data is submitted directly to Stripe and never touches our servers, which keeps the application out of PCI SAQ-D scope (see `SecurityDocument.md` §PCI Scope).
* **Webhook endpoint:** A single authenticated webhook route verifies Stripe's signature, then persists to `Transactions` (Design Doc §13) — `gateway_ref_id`, `amount_paid`, `processing_fee`, `net_amount`, `charge_status`, `refunded_amount`, `payout_batch_id`, `payout_status`. Handles at minimum: `checkout.session.completed` (purchase), `payout.paid` / `payout.failed` (payout reconciliation, Design Doc §7.3), and refund/dispute events (`charge.refunded`, `charge.dispute.created`).
* **Dynamic pricing:** Price computation (Design Doc §7.1, §12.1) happens server-side at checkout-session creation time, reading current values from the `System Settings` config store — never trust a client-submitted price.
* **Tax:** not collected (Design Doc §7.1) — no Stripe Tax integration for now. If that assumption changes, Stripe Tax is the recommended path rather than hand-rolled tax logic.

## **8. Background & Scheduled Jobs**

Amplify/Next.js compute is request-response; a few spec'd behaviors are inherently async or time-triggered and need an explicit mechanism rather than living inline in a request handler:

| Job | Trigger | What it does |
| :---- | :---- | :---- |
| Recurring session rollforward | Daily, via **EventBridge Scheduler** | For each active `Recurrence_Rule` (Design Doc §13), generates new `Sessions` instances far enough ahead to keep the rolling booking window populated (Design Doc §9.2). |
| Weekly Model Payout Report | Weekly, via **EventBridge Scheduler** | Computes `sessions_worked × rate_applied` per model for the past week, writes a `Model_Payout_Reports` row (Design Doc §13), and emails it to the Controller via SES (Design Doc §10). |

Both are implemented as EventBridge Scheduler rules invoking a protected internal API route in the Next.js app (shared-secret header, not publicly reachable) rather than a separate Lambda codebase — keeps job logic in the same codebase and deployable through the same Amplify pipeline.

**Not a scheduled job:** the waitlist "spot opened" broadcast (Design Doc §6.4) fires synchronously from the cancellation handler via SES, since expected volume per session (capacity ≤25) is small enough that a queue would be unnecessary complexity. Revisit with a queue (e.g. SQS) only if volume or SES rate limits become a real constraint.

## **9. External API Access**

Design Doc §10 calls for a "secure REST/GraphQL API... for authenticated querying by external tools and scripts." This is separate from the app's own session-cookie-authenticated requests: external tools use **admin-issued, scoped API keys** (hashed at rest like passwords, never stored/logged in plaintext; presented as a Bearer token) rather than reusing the member-facing Auth.js session flow. Admins generate and revoke keys, each scoped to specific report types, from an admin-only screen — keeping this out of the member-facing auth surface entirely.

## **10. Testing Strategy**

* **Unit/integration:** Vitest, covering pass lifecycle logic (assignment, cancellation/release, effective-price calculation — Design Doc §6.1, §6.6), booking-window and cancellation-cutoff date math (Design Doc §12.1), recurrence-rule generation and the three-way edit-scope split (Design Doc §9.2), and RBAC route-guard logic. Run locally with `npm run test`, against the Docker Compose database (§5).
* **End-to-end:** Playwright, covering the critical user-facing flows called out in the design doc: book → cancel (before/after the 24h cutoff) → pass returns to balance; sold-out session → join waitlist → alert-driven re-booking; multi-week series partial-date seat booking; transferable pass gift → claim; admin session creation across all four patterns (Design Doc §9.2). Run locally with `npm run test:e2e` against a local dev server backed by the seeded local database (§5); Stripe flows in E2E tests use Stripe's test-mode card numbers, no live charges.
* CI runs both suites as required checks before merge to the production branch (§6), using the same seed script and a fresh ephemeral Postgres instance (not shared state with staging/prod).

## **11. Rate Limiting & Abuse Protection**

`SecurityDocument.md` §2 requires rate-limiting on login and pass-claim attempts. Given the scale of a single-studio nonprofit application, an app-level limiter (a small Postgres table or in-memory store tracking attempts per account/IP with a sliding window) is sufficient — provisioning AWS WAF is not justified at this scale and adds ongoing cost/complexity. Revisit WAF only if the app sees real bot/abuse traffic post-launch.

## **12. Observability**

* **Baseline:** CloudWatch logs (Amplify build/runtime logs, RDS logs) and CloudWatch Alarms for basic health signals (error rate, DB connection saturation, scheduled job failures from §8).
* **Open question:** whether to add a dedicated error-tracking tool (e.g. Sentry) for structured exception capture and alerting beyond what CloudWatch gives out of the box. Not decided — revisit once the app has real traffic patterns to inform whether CloudWatch alone is sufficient.
