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
