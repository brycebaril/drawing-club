import type { Role } from "./roles";

interface RouteRule {
  pattern: string;
  /** Allowed regardless of auth state, including unauthenticated visitors. */
  public?: true;
  /** Only reachable by unauthenticated visitors (e.g. login/register). */
  guestOnly?: true;
  /** Any of these roles grants access. ADMIN is implicitly allowed everywhere. */
  allow?: Role[];
}

/**
 * Transcribes SiteOutline.md §4's Route Access Matrix. Ordered
 * most-specific-first since the first matching rule wins.
 *
 * Not modeled here (left to route handlers per docs/SecurityDocument.md §3):
 * resource-scoped checks, e.g. VOL_HOST at /ops/check-in/:session_id being
 * restricted to sessions they're actually assigned to host.
 */
const AUTHENTICATED_ROLES: Role[] = ["ACCT", "MBR", "VOL_HOST", "VOL_MKT", "VOL_MBR", "VOL_CTRL"];

const ROUTE_RULES: RouteRule[] = [
  { pattern: "/auth/login", guestOnly: true },
  { pattern: "/auth/register", guestOnly: true },
  { pattern: "/auth/forgot-password", guestOnly: true },
  { pattern: "/auth/reset-password", public: true }, // reachable whether or not the clicker still has a session
  { pattern: "/auth/verify-email", public: true }, // reachable whether or not the clicker still has a session
  { pattern: "/auth/mfa-setup", allow: AUTHENTICATED_ROLES }, // forced here by middleware when mfaRequired && !mfaEnabled
  // Reachable by guests too — /app/schedule is the unified public + member
  // schedule page (a guest sees the same grid and detail modal, just with
  // login-gated actions instead of real booking forms; see
  // src/app/app/schedule/page.tsx). Must come before the /app/* rule below
  // since rules are first-match-wins.
  { pattern: "/app/schedule", public: true },
  { pattern: "/app/*", allow: AUTHENTICATED_ROLES },
  { pattern: "/dashboard", allow: AUTHENTICATED_ROLES },
  { pattern: "/ops/check-in/*", allow: ["VOL_HOST", "VOL_MBR"] },
  { pattern: "/ops/cms", allow: ["VOL_MKT"] },
  { pattern: "/ops/cms/*", allow: ["VOL_MKT"] },
  { pattern: "/ops/model-booking", allow: ["VOL_MBR"] },
  { pattern: "/ops/model-booking/*", allow: ["VOL_MBR"] },
  { pattern: "/ops/financials", allow: ["VOL_CTRL"] },
  { pattern: "/ops/financials/*", allow: ["VOL_CTRL"] },
  { pattern: "/ops/support", allow: ["VOL_SUPPORT"] },
  { pattern: "/ops/support/*", allow: ["VOL_SUPPORT"] },
  { pattern: "/admin/*", allow: [] }, // ADMIN-only via the implicit rule below
  { pattern: "/", public: true },
  { pattern: "/about", public: true },
  { pattern: "/news", public: true },
  { pattern: "/news/*", public: true },
  { pattern: "/contact", public: true },
  { pattern: "/pricing", public: true },
  // One rule covers every admin-created static page, present and future —
  // see src/app/pages/[slug]/page.tsx.
  { pattern: "/pages/*", public: true },
  // Uploaded files (src/lib/uploads/storage.ts's local-disk fallback) are
  // served from public/ specifically so CMS content (public pages included)
  // can reference them — without this rule they fell through the default
  // fail-closed and got redirected to /auth/login for any guest, breaking
  // every uploaded image on every public page whenever S3 isn't configured.
  { pattern: "/uploads/*", public: true },
];

function matchesPattern(pathname: string, pattern: string): boolean {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  }
  return pathname === pattern;
}

function findRule(pathname: string): RouteRule | undefined {
  return ROUTE_RULES.find((rule) => matchesPattern(pathname, rule.pattern));
}

/**
 * @param roles null for an unauthenticated visitor (GUEST); otherwise the
 * authenticated user's resolved role set from getUserAuthContext().
 */
export function isAllowed(pathname: string, roles: Role[] | null): boolean {
  const rule = findRule(pathname);
  if (!rule) return false; // fail closed: unknown routes require an explicit rule

  if (rule.public) return true;
  if (rule.guestOnly) return roles === null;
  if (roles === null) return false;
  if (roles.includes("ADMIN")) return true;
  return (rule.allow ?? []).some((allowedRole) => roles.includes(allowedRole));
}
