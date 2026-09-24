# Production Environment

This document is the concrete runbook for the `prod` environment named in
`ArchitectureDocument.md` §4, mirroring `docs/StagingEnvironment.md`'s
structure. Unlike staging, **provisioning this environment has not happened
yet** — this doc is written ahead of that work so the AWS-side setup has a
concrete target to match, the same way `StagingEnvironment.md` was. Cells
that depend on real AWS resources existing are marked `TBD — filled in
during provisioning`; fill them in (and update the status table below) as
the actual provisioning happens.

**The initial production launch is static-only** (see
`docs/ImplementationNotesArchive.md`'s "Static-only launch mode
implementation notes"): this same codebase, deployed for real, with
member-facing booking/registration/payments gated off via `LAUNCH_MODE`
while public content (Home/About/News/Contact/Pricing/CMS pages) and staff
CMS access go live immediately. "Activating the backend" later is a
`LAUNCH_MODE=full` flip plus the legacy data migration cutover
(`docs/MigrationPlan.md`) — not a second deployment.

## What's provisioned, and what's deliberately not

| Component | Status | Notes |
| :--- | :--- | :--- |
| Amplify Hosting | **Not yet provisioned** | New Amplify app, or a new branch on the existing staging app — branch strategy TBD. Tracks the `prod`-mapped branch; auto-builds on push via the repo-root `amplify.yml` (same file staging uses, now also allowlisting `LAUNCH_MODE` in its build-time `env | grep` step). |
| RDS for PostgreSQL 18 | **Not yet provisioned** | Real member/CMS data from day one, not disposable rehearsal data — prefer Secrets-Manager-managed rotating master credentials from the start (`DATABASE_SECRET_ARN`, `src/lib/db/pool.ts`) rather than repeating staging's original static-password mistake, which caused a real outage on 2026-09-06 (see `docs/StagingEnvironment.md`'s Secrets section). Same Postgres major version as local dev/CI/staging, for the same no-version-skew reasoning. |
| S3 | **Not yet provisioned** | CMS uploads bucket — needed from day one, since About/News/Pricing/extra-page content will reference real uploaded images as soon as staff start using `/ops/cms`. |
| SES (email) | **Not yet provisioned; start the AWS production-access review early regardless** | Until granted, `sendEmail()`'s existing console-log fallback means the contact form (the one interactive feature of the static-only launch) silently logs instead of delivering. SES production access is an external, multi-day AWS review — start it as soon as this environment is being set up, independent of when the rest of launch ships, since it's also on the critical path for real booking/verification email once the backend activates later. |
| Custom domain | **Not yet provisioned** | `lifedrawing.org` DNS → Amplify + ACM cert, needed for a real public launch (unlike staging, which is fine on Amplify's own default URL). |
| RDS Proxy | Not provisioned, matching staging | Add only if real production traffic later needs it — no different reasoning than staging's own deferral. |
| EventBridge Scheduler jobs | Not provisioned, matching staging | `pnpm rollforward`/`pnpm generate-payouts` still need to run manually (or via the existing GitHub Actions cron for the volunteer-pass job) until this infra exists — a pre-existing app-level gap, not specific to this environment. |
| WAF | Not provisioned, matching staging | `ArchitectureDocument.md` §11's own call. |

## Secrets

Follow `docs/StagingEnvironment.md`'s exact pattern — don't repeat its
original mistake. Set the DB credential up as a Secrets-Manager-managed
rotating password (`DATABASE_SECRET_ARN`) from RDS creation time, not a
static `DATABASE_URL` password pasted once. Every other secret (Stripe,
NextAuth, the job-trigger secret) is a plain Amplify Console environment
variable, same as staging — closing that gap too (reading them from Secrets
Manager as well) remains a deliberate future hardening task for this
environment too.

**`STRIPE_SECRET_KEY` must be a real live-mode key (`sk_live_...`) here**,
not the shared test-mode key staging reuses — `EnvStatusBanner` (via
`src/lib/envStatus.ts`'s `isAnomalous` check) already alarms in production
if it isn't, self-checking this the moment an admin looks at the banner.
During the static-only launch phase this matters less (no checkout flows
are reachable), but should be set correctly from the start regardless.

## How deploys work

Identical mechanism to staging (`amplify.yml`, Amplify Hosting's built-in
git-based pipeline): `pnpm install --frozen-lockfile --config.node-linker=hoisted`
→ `pnpm exec node-pg-migrate up` → env vars written into a real `.env` file
→ `pnpm build`. Same deliberate omission as staging: no automated
seed/reset on every push.

**Never run `pnpm seed` against this environment** — every seeded account
shares one hardcoded dev password (`dev-password-change-me`), fine for
local dev/CI/staging rehearsals, actively unsafe on a real production
database with a real public URL. Use `pnpm bootstrap-admin
--username=... --email=... --password=...` (see
`docs/ImplementationNotesArchive.md`'s static-only launch notes) to create
the first real ADMIN account instead, then have that admin write real
content through `/ops/cms` and `/admin/settings` directly.

## Environment variables

Same table shape as `docs/StagingEnvironment.md`; rows that don't depend on
real AWS resources existing are filled in now, infra-dependent ones are
`TBD`.

| Variable | Production value |
| :--- | :--- |
| `ORG_LEGAL_NAME` | Amplify env var — same real value as `.env.example`. |
| `ORG_DBA_NAME` | Amplify env var — same real value. |
| `APP_ENV` | Amplify env var, set to `production`. |
| `LAUNCH_MODE` | Amplify env var, set to `static_only` for the initial launch — **this is the one line that actually turns static-only mode on**; flip to `full` (or unset) at real cutover (see the static-only launch notes' cutover sequence). |
| `GIT_SHA` | Left unset — derived automatically at build time. |
| `DATABASE_URL` / `DATABASE_SECRET_ARN` | TBD — filled in during provisioning (RDS-managed rotating credential template + secret ARN, per the Secrets section above). |
| `NEXTAUTH_SECRET` | TBD — a new, distinct value generated with `openssl rand -base64 32`. Never reuse local dev/CI/staging's value. |
| `NEXTAUTH_URL` | TBD — the real production URL (`https://lifedrawing.org` once the custom domain is wired, the Amplify default URL until then). |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | TBD — real live-mode keys, not staging's shared test-mode ones. |
| `STRIPE_WEBHOOK_SECRET` | TBD — the signing secret for a webhook endpoint registered against this environment's own `/api/webhooks/stripe` URL. |
| `AWS_REGION` / `SES_FROM_EMAIL` | TBD — left unset until SES production access is granted (see the provisioning table above); the app runs correctly on the console-log fallback in the meantime. |
| `S3_BUCKET_NAME` | TBD — this environment's own uploads bucket name. |
| `JOB_TRIGGER_SECRET` | TBD — a new, distinct generated value. |
| `CONTACT_FORM_RECIPIENT_EMAIL` | TBD — a real staff inbox address; only actually delivers once SES is out of sandbox. |
| `LEGACY_MYSQL_URL` | Not an Amplify env var — only ever used from your own machine when running the real migration cutover (`docs/MigrationPlan.md`), pointed at a throwaway local import of the final legacy delta export, never a persistent env var here. |

## Reset flows

**None, deliberately.** Unlike staging, there is no routine reset here —
this is real member data once the migration cutover happens. The only
one-time bootstrap action is `pnpm bootstrap-admin` (see above), run once
against a genuinely empty database before any content exists.

## Known limitations (initial static-only launch)

- No real email delivery until SES clears sandbox review — the contact
  form logs to CloudWatch instead of sending.
- No background job scheduling — same gap as staging.
- Booking/registration/payments are intentionally closed
  (`LAUNCH_MODE=static_only`) — this is the entire point of the initial
  launch, not an oversight. See `docs/ImplementationNotesArchive.md`'s
  static-only launch notes for the full mechanism and the cutover sequence
  back to full mode.
