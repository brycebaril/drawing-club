# Staging Environment

This document is the concrete runbook for the `staging` environment named in
`ArchitectureDocument.md` §4. It exists for two reasons:

1. **Pre-production rehearsal** — a real, deployed target to test against before any change goes
   to production, closer to real infrastructure than local dev.
2. **The legacy data migration's rehearsal target** — `MigrationPlan.md` §8 phase 4 explicitly
   calls out that the migration scripts (`pnpm migrate-legacy-data`) have only ever run against
   the local dev database, because a real AWS staging environment didn't exist. Once staging is
   up, migration rehearsals should run here instead, against real (if disposable) infrastructure.

This doc assumes the AWS-side setup described below has already happened (account, RDS, S3,
Amplify app) — that's manual console/CLI work, not something checked into this repo. If you're
doing that setup for the first time, this doc's env-var table and "how deploys work" sections are
what the AWS side needs to match.

## What's provisioned, and what's deliberately not

| Component | Status | Why |
| :--- | :--- | :--- |
| Amplify Hosting | Provisioned | Tracks the `staging` git branch; auto-builds on push via `amplify.yml` at the repo root. |
| RDS for PostgreSQL 18 | Provisioned | `db.t4g.micro`, single-AZ, **publicly accessible** (see "A real gap worth knowing about: network exposure" below — this was not the original design). Matches `docker-compose.yml`'s Postgres major version — deliberately chosen to be the same everywhere (local dev, CI, staging) rather than picking one version for staging in isolation, since a version skew between environments is exactly the "works locally, breaks in staging" risk this setup is trying to avoid. |
| S3 | Provisioned | One bucket for CMS uploads, public-read only on object `GetObject`, not the bucket itself. |
| SES (email) | **Not provisioned** | Staging uses the app's existing console-log fallback (`src/lib/email/sender.ts`) instead of sending real email. No SES setup, no sandbox-approval wait. If a change ever needs to prove real delivery, that's a deliberate future addition, not a staging default. |
| Custom domain | **Not provisioned** | Staging is reachable at Amplify's own default URL (`https://staging.<app-id>.amplifyapp.com`). No DNS/Route 53 work for an internal rehearsal environment. |
| RDS Proxy | **Not provisioned** | Exists in the architecture doc to handle production's connection pooling under real concurrent load. Staging's traffic (a handful of testers, migration rehearsals) doesn't need it. Add it if staging is ever used for real load testing. |
| EventBridge Scheduler jobs | **Not provisioned** | `ArchitectureDocument.md` §8 describes these as invoking a protected internal API route — that route doesn't exist in the app yet, only the underlying CLI scripts (`pnpm rollforward`, `pnpm generate-payouts`) do. This is a pre-existing app-level gap, not staging-specific; run the scripts manually on staging the same way you would in production today. |
| WAF | **Not provisioned** | `ArchitectureDocument.md` §11's own call — not justified at this scale. |

## A real gap worth knowing about: secrets

`SecurityDocument.md` §4 describes secrets being read "via IAM role... not plaintext Amplify
environment variables." As built, the app only ever reads `process.env.*` directly — there's no
AWS SDK Secrets Manager client anywhere in the codebase (`@aws-sdk/client-s3` and
`@aws-sdk/client-sesv2` exist; `@aws-sdk/client-secrets-manager` does not). True runtime
Secrets-Manager-backed config would need real app code (fetch secrets at boot, or per-request)
that doesn't exist today.

For now, staging's secrets are set directly in **Amplify Console → App settings → Environment
variables** — still encrypted at rest and access-controlled to whoever has Console/IAM
permissions on the app, just without Secrets Manager's separate audit trail and rotation
tooling. The one exception is the database credential itself: RDS's own "manage master
credentials in Secrets Manager" option (set at RDS creation time) covers that one specifically
with no app code involved, since the DB connection string is assembled once at setup time, not
fetched by the running app.

Closing this gap for real (the app reading secrets from Secrets Manager at runtime) is a
deliberate future hardening task, not something this doc's setup silently papers over.

## A real gap worth knowing about: network exposure

The original design (and this doc's earlier draft) called for RDS to sit in a private subnet,
reachable only via a VPC-attached compute path. That turned out not to be buildable:
**AWS Amplify Hosting's SSR compute has no VPC integration** — no subnet/security-group
attachment point exists anywhere in the Amplify API (confirmed by exhausting every `aws amplify`
CLI command's parameters, and independently corroborated by the complete absence of any current
documentation describing one — the only related source found is a 2022 APN blog post working
around the same gap, not a real integration). Amplify's compute simply cannot reach a database
sitting in a private subnet.

Given that, and given the alternatives (moving staging's compute off Amplify Hosting onto a
VPC-attachable service like App Runner/Fargate — defeats the point of staging as a same-stack
rehearsal environment; or migrating to Aurora Serverless + the HTTP-based Data API — a real
engine change and app-layer rewrite of the raw-`pg` data layer, far beyond what "stand up
staging" calls for), the pragmatic call for staging specifically is: **RDS is publicly
accessible**, gated by its Secrets-Manager-managed master password (rotated at setup) rather
than network isolation. The security group (`drawing-club-staging-rds-sg`) allows inbound `5432`
from `0.0.0.0/0` — AWS doesn't publish a scoped IP range for Amplify's compute, so there's no
narrower CIDR to restrict this to.

**This is a real, deliberate trade-off, not an oversight** — worth revisiting if staging ever
holds data more sensitive than disposable rehearsal data, or if AWS ships real Amplify↔VPC
integration later. It does not change anything about production's own architecture — this gap is
specific to how *this staging environment* was provisioned, not a statement that production
should also expose its database.

## How deploys work

Amplify Hosting tracks the `staging` branch. Every push to it triggers a build using
`amplify.yml` at the repo root:

1. `pnpm install --frozen-lockfile`
2. `node-pg-migrate up` — runs any pending schema migrations against the staging database
   **before** the app builds, so the deployed code is never running against a stale schema.
3. `pnpm build`

**Deliberately not part of the automated build**: seeding or resetting data. That stays a manual,
occasional action (see "Reset flows" below) — an automatic reset on every push would wipe an
in-progress migration rehearsal or manual test setup the moment anyone merges an unrelated PR.

## Reaching the database

Per the network-exposure trade-off above, RDS is directly reachable at its endpoint — no tunnel
needed. For any ad-hoc admin work (running `pnpm seed`, a migration rehearsal, or just `psql`),
point `DATABASE_URL` straight at
`postgres://<user>:<password>@<rds-endpoint>:5432/postgres` (pull the current password from
Secrets Manager — the secret named `rds!db-...` under the RDS instance's own console page, or
`aws secretsmanager get-secret-value`) for whichever script you're running.

**Treat that connection string with real care** — it's a live credential to a publicly reachable
database. Don't paste it into a chat/AI tool transcript, a shared doc, or a log that isn't
access-controlled; if it's ever exposed, rotate it immediately (RDS console → the instance →
Secrets Manager → the secret → "Rotate secret immediately", or
`aws rds modify-db-instance --rotate-master-user-password`) and every existing session using the
old password will need reconnecting with the new one, Amplify's own `DATABASE_URL` env var
included.

## Reset flows

Two different things you might want, depending on what you're testing:

- **A clean baseline of ordinary test data**: `pnpm seed` (against a `DATABASE_URL` pointed at
  the SSM-tunneled staging DB). Creates one account per role, sessions across all four creation
  patterns, some spent/unspent/transferable passes, a full session to exercise the waitlist —
  same script local dev and CI both already use.
- **A real migration rehearsal**: `pnpm migrate-legacy-data -- --reset` (also against the tunneled
  `DATABASE_URL`), with `LEGACY_MYSQL_URL` pointed at a throwaway local MySQL container loaded
  from the gitignored `legacy_data/*.sql` dump — the same setup local dev already uses for this,
  just with the destination now being staging's real RDS instance instead of the local Docker
  Postgres. **Never commit the dump, and never point a rehearsal at anything but this throwaway
  container** — `legacy_data/` holds real member PII and is gitignored on purpose. See
  `MigrationPlan.md` §8 for the full flag reference (`--reset`, `--cutover-date`).

Either way, the very next thing after a reset is confirming the seeded/migrated data actually
renders — log in as the seeded `admin` account (or a migrated real account, for a rehearsal) on
the staging URL and check `/admin/sessions` and `/app/schedule`.

## Environment variables

Every variable `.env.example` documents, and how staging sets it. "Amplify env var" means: set
directly in Amplify Console → App settings → Environment variables (see the Secrets section above
for why this isn't Secrets Manager yet).

| Variable | Staging value |
| :--- | :--- |
| `ORG_LEGAL_NAME` | Amplify env var — same real value as local dev's `.env.example`. |
| `ORG_DBA_NAME` | Amplify env var — same real value. |
| `APP_ENV` | Amplify env var, set to `staging`. This is what `EnvStatusBanner` reads to show informational (not alarmed) styling — it only alarms when `APP_ENV=production` and something looks misconfigured. |
| `GIT_SHA` | Left unset — `next.config.ts` derives it automatically from the checked-out commit at build time. |
| `DATABASE_URL` | Amplify env var, built from the RDS-managed master credential (see the Secrets section) plus the staging RDS instance's endpoint/port/db name. |
| `NEXTAUTH_SECRET` | Amplify env var — a **new, distinct** value generated with `openssl rand -base64 32`. Never reuse the value from local dev, CI, or (eventually) production. |
| `NEXTAUTH_URL` | Amplify env var, set to the staging app's actual Amplify default URL. |
| `STRIPE_SECRET_KEY` | Amplify env var — reuse the **same Stripe test-mode key** local dev already uses. Test mode is shared across dev/staging; only production needs a real live-mode key. |
| `STRIPE_PUBLISHABLE_KEY` | Amplify env var — same test-mode key as above. |
| `STRIPE_WEBHOOK_SECRET` | Amplify env var — the webhook signing secret for whichever Stripe webhook endpoint you point at staging's own `/api/webhooks/stripe` URL (a separate Stripe CLI/Dashboard-registered endpoint from local dev's, since it's a different URL). |
| `AWS_REGION` | **Left unset** — SES is intentionally not provisioned for staging; this keeps the app on its console-log email fallback. |
| `SES_FROM_EMAIL` | **Left unset**, same reason. |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Left unset — Amplify compute uses its own service role's IAM credentials for S3 access, not static keys. |
| `S3_BUCKET_NAME` | Amplify env var — the staging uploads bucket's name. |
| `JOB_TRIGGER_SECRET` | Amplify env var — a new, distinct generated value, for whenever the internal job-trigger route described in `ArchitectureDocument.md` §8 actually gets built. Harmless to set now even though nothing reads it yet. |
| `LEGACY_MYSQL_URL` | **Not an Amplify env var at all** — only ever used locally/from your own machine when running a migration rehearsal (see "Reset flows" above), pointed at a throwaway container, never at anything staging's own compute needs to know about. |

## Known limitations

- No real email delivery — everything logs to CloudWatch instead of sending. Fine for testing
  every flow's logic; not a way to visually check what a real email looks like.
- No background job scheduling — `pnpm rollforward`/`pnpm generate-payouts` need to be run
  manually against staging (via the SSM tunnel) if you want their effects visible there.
- No RDS Proxy — staging can't meaningfully load-test connection-pooling behavior.
- Secrets aren't actually Secrets-Manager-backed at runtime yet (see above) — Amplify env vars
  are the real mechanism today, despite what `SecurityDocument.md` §4 describes as the target.
- No custom domain — the Amplify default URL is what gets shared with anyone testing staging.
