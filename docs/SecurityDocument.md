# **Security Document: Life Drawing Society Scheduling System**

## **1. Overview**

This document specifies the security posture for the system described in `DesignDocument.md`, `SiteOutline.md`, and `ArchitectureDocument.md`. It covers authentication/session security, authorization enforcement, secrets handling, payment scope, and data protection/compliance — the areas the design docs assume but don't specify.

## **2. Authentication & Session Security**

* **Password storage:** hashed with argon2id (memory-hard, current OWASP recommendation), never reversible encryption. Matches Design Doc §5.1's requirement that credentials be "securely captured and stored."
* **Sessions:** Auth.js-managed session cookies — `httpOnly`, `secure`, `sameSite=lax` at minimum. Session tokens rotate on privilege-relevant events (e.g. role change, password change, ban/suspend action per Design Doc §5.2).
* **CSRF:** handled by Auth.js's built-in CSRF token flow for credential-based sign-in and any state-changing form submissions outside of it.
* **Brute-force protection:** rate-limit and temporarily lock login attempts per account/IP. Applies to `/auth/login` (`src/lib/auth/rateLimit.ts`). **Revised 2026-08-29**: this bullet previously also named the pass-claim flow (`/app/wallet/claim`) as a second rate-limited credential surface — that flow, its claim codes, and the `claim_attempts` table were removed entirely when pass sharing moved to direct-ownership transfers (see CLAUDE.md's Pass sharing implementation notes); confirmed via full-repo grep that no live code references any of it. The password-reset *request* endpoint (`requestPasswordResetAction`, below) has a per-account outstanding-token cap but no IP-level throttling of its own — low-risk (reset tokens are 256-bit random; this only bounds an unthrottled probing/resource-exhaustion surface, not credential guessing) and not yet required by this bullet, but worth adding if `/auth/login`-style IP limiting is ever extended to it.
* **Account status enforcement:** `Suspended`/`Banned` status (Design Doc §13 Users schema) must be checked at session-validation time, not just at login — a banned user's *existing* session should stop working, not just future logins (Site Outline's Account Governance Modal explicitly warns of "automated cancellation of upcoming booked sessions upon banning," which implies the session itself needs to lose effect immediately).
* **Email verification:** enforced server-side, not just as a UI gate — any booking or purchase mutation checks `Users.email_verified_at IS NOT NULL` (Design Doc §5.1, §13) regardless of what the client shows. Browsing/reading remains available pre-verification.
* **Password reset:** added 2026-08-19 — this app previously had no account-recovery mechanism at all. Mirrors email verification's token shape exactly: only a SHA-256 hash of the token is ever stored (`password_reset_tokens`, never the raw value), a 1-hour TTL (shorter than email verification's 24h — a reset token is a higher-value secret), and single-use (consuming a token invalidates every other outstanding token for the same account, so an older still-unexpired link can't also be used afterward). `requestPasswordResetAction` always returns the same generic response regardless of whether the submitted username/email actually matches an account, so the flow can't be used to enumerate registered identities; a per-account cap (3 outstanding tokens per 15-minute window) limits inbox-spamming a target. Session invalidation on reset isn't possible with this app's stateless JWT session strategy (no server-side session table to revoke against) — a password reset stops *future* logins with the old password but doesn't force out an already-issued session token.
* **Multi-factor authentication:** required for `ADMIN` and `VOL_CTRL` (Controller) accounts, given their access to refunds, bans, and financial reports (Design Doc §5.1). TOTP-based (standard authenticator app), enforced as a second step after password verification during login — the account's `mfa_enabled` flag (Design Doc §13) is checked before granting a session, and enrollment is required (not optional/skippable) the first time a user is granted one of these roles. Not required for other roles at launch.

## **3. Authorization (RBAC) Enforcement**

* **Single enforcement point:** role/route access is enforced centrally in Next.js Proxy (`src/proxy.ts` — the current name for what was called "Middleware" before Next.js 16; same mechanism, renamed), checked against the access matrix in `SiteOutline.md` §4, rather than re-implemented per page or per API route. Proxy defaults to the Node.js runtime as of Next 16, which is what lets it query Postgres directly on every request instead of trusting cached JWT claims — see `ArchitectureDocument.md` §2. It resolves the requesting user's full role set — base role plus zero or more volunteer sub-roles from `Volunteer_Roles` (Design Doc §13; a user can hold multiple simultaneously) — and grants access if *any* held role permits the route, denying before the route handler runs.
* **Resource-scoped checks still needed in-handler:** the matrix in §4 is route-level, but some access is further scoped to a specific resource — e.g. `VOL_HOST` at `/ops/check-in/:session_id` is only permitted for sessions they're assigned to host (Site Outline §3.3). Proxy can't express that; the route handler must check `host_user_id` against the session user.
* **API routes are excluded from Proxy entirely** (`/api/*`) — they need their own auth handling (a 401 JSON response, or a bearer-token check for the Stats API per `ArchitectureDocument.md` §9) rather than a redirect to an HTML login page.
* **Server-side authority on all mutations:** every state-changing action (booking, cancellation, refund, ban, pass grant, setting change) re-validates role and resource ownership server-side regardless of what the client UI shows/hides. The UI's disabled/hidden states (e.g. the non-cancelable lock icon past the 24h cutoff, Design Doc §3.3) are a UX affordance, not a security boundary.

## **4. Secrets Management**

* **AWS Secrets Manager** holds: RDS credentials, Stripe secret key + webhook signing secret, NextAuth secret, SES credentials.
* Application reads secrets at runtime via IAM role (Amplify compute role scoped to `secretsmanager:GetSecretValue` on only the specific secret ARNs it needs) — not plaintext Amplify environment variables, which are visible in the Amplify console to anyone with app access and aren't rotatable through the same audit trail Secrets Manager provides.
* Secrets are never committed to the repo, logged, or included in error messages/stack traces sent to observability tooling.

## **5. PCI Scope**

Card data is submitted directly to Stripe via Checkout/Elements (`ArchitectureDocument.md` §7) — the application never receives, transmits, or stores raw card numbers. This keeps PCI scope to SAQ-A (the lightest self-assessment tier), rather than the application needing to be PCI-DSS compliant itself. This does **not** cover: securing the Stripe API keys themselves (§4 above), or ensuring the checkout page itself isn't compromised (e.g. via a supply-chain attack on a client-side dependency skimming form data before Stripe's SDK captures it) — standard dependency-scanning (§7) is the mitigation for that class of risk.

## **6. Data Protection & Compliance**

* **Encryption in transit:** TLS enforced end-to-end (Amplify Hosting terminates TLS for the app; RDS connections use TLS).
* **Encryption at rest:** RDS storage encryption enabled; S3 buckets holding any uploaded assets encrypted at rest (SSE-S3 or SSE-KMS).
* **International members (GDPR-relevant):** the design doc doesn't currently define data subject rights, consent tracking, or retention limits — these need to be added before handling EU (or otherwise GDPR-applicable) member data:
  * **Data export/delete requests:** a user-initiated or admin-assisted process to export a member's personal data and to delete/anonymize it on request, reconciled against the retention needs below (financial/audit records generally cannot simply be deleted on request — see next bullet).
  * **Consent for marketing communications:** the News & Announcements feature (Design Doc §8) is public-facing content, but any *opt-in* marketing email (as opposed to transactional email like receipts and waitlist alerts) needs explicit, revocable consent tracked per user.
  * **Retention policy:** `System_Audit_Logs` and `Transactions` are described in the design doc as effectively permanent (audit trail, tax/accounting records) — this creates tension with a blanket "delete on request" capability. **Open item, needs org/legal input:** define a retention period and a policy for anonymizing (rather than deleting) personal identifiers on financial/audit records after account deletion, so accounting integrity is preserved without retaining more personal data than necessary.
  * **Jurisdiction scope:** which specific jurisdictions' rules apply (GDPR proper vs. UK GDPR vs. other regional equivalents) depends on where the international members actually are — flagged as needing organizational/legal confirmation rather than assumed here.

## **7. Dependency & Vulnerability Management**

* Automated dependency vulnerability scanning (e.g. `npm audit` / GitHub Dependabot alerts) runs in CI as a required check (`ArchitectureDocument.md` §6), catching known-vulnerable packages before merge rather than only at manual review time.
* Given the PCI-scope note in §5, particular attention goes to any dependency loaded on pages that render the Stripe Checkout/Elements flow.

## **8. User-Generated Content Sanitization**

Several surfaces accept rich text/markdown from authenticated users and render it back to other users: the CMS blog/static-page editor (Design Doc §8, `VOL_MKT`/`ADMIN`) and the Attributed Session Notes log (`SiteOutline.md` §3.3, any of `VOL_HOST`/`VOL_MBR`/`ADMIN`). Both are stored-XSS risk surfaces — content authored by one privileged-but-not-fully-trusted user is later rendered in another user's browser. Markdown is rendered through a sanitizing renderer that strips raw HTML/script content rather than trusting author input directly; this applies uniformly regardless of the author's role, since even volunteer accounts shouldn't be treated as fully trusted with arbitrary HTML.

## **9. Audit Logging**

Design Doc §13's `System_Audit_Logs` table and §10's "System & Account Audit Logs" requirement already define *what* gets logged. This document specifies *how* it gets written reliably: audit-log writes happen inside a single shared service function called by every admin/volunteer mutation path (pass grants, refunds, bans, membership adjustments, setting changes), not scattered `INSERT` calls duplicated across each admin action's handler. This guarantees no privileged mutation can accidentally skip logging, and keeps the log schema (`action_type` values, `metadata` shape) consistent across all call sites.
