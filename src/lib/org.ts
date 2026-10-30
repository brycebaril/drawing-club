/**
 * Deployment-level org identity — not a system_settings row. Unlike
 * business config (pricing, cutoffs, booking windows), branding is set
 * once per instance, same category as SES_FROM_EMAIL/STRIPE_SECRET_KEY/
 * NEXTAUTH_URL. A fork running this for a different drawing group changes
 * .env, not code. Falls back to a generic name if unset, same defensive
 * style as src/lib/email/sender.ts's console-log fallback.
 */
export const ORG_LEGAL_NAME = process.env.ORG_LEGAL_NAME ?? "Life Drawing Society";
export const ORG_DBA_NAME = process.env.ORG_DBA_NAME ?? ORG_LEGAL_NAME;

// The studio's one fixed real-world timezone (IANA name). Every session
// time in this app is a physical, in-person event at one location — display
// must always show that location's wall-clock time, not the rendering
// process's ambient timezone (which defaults to UTC on Amplify's Lambda
// runtime) or the viewer's own browser timezone (which would show a member
// in another timezone a "translated" time instead of the real studio time).
// Discovered as a real, previously-invisible bug: every Intl.DateTimeFormat/
// toLocaleDateString/toLocaleTimeString call in this codebase used to omit
// an explicit `timeZone`, so it silently followed the local dev machine's
// own Pacific timezone — invisible until the app ran anywhere else for the
// first time (staging's Amplify deploy), where sessions rendered up to 8
// hours off, including landing on the wrong calendar day/slot entirely.
// America/Los_Angeles, not America/Vancouver: identical DST rules (same
// Pacific Time transitions), but a far more canonical/commonly-exercised
// IANA zone. Switched 2026-10-29 after finding a real corrupted tzdata entry
// for America/Vancouver on a GitHub Actions runner (Nov 1 2026's fall-back
// transition flipped `isdst` but never changed `gmtoff`, so Pacific time
// stayed off by an hour after the transition) — confirmed via `zdump`, not
// a Node/ICU version issue (identical on Node 22 and 24). A CI-only tzdata
// reinstall would've masked this on GitHub Actions but left the same risk
// live on Amplify's Lambda runtime; this fixes it everywhere at once.
export const ORG_TIMEZONE = process.env.ORG_TIMEZONE ?? "America/Los_Angeles";
