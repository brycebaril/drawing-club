import { matchesPattern } from "@/lib/auth/rbac";

/**
 * Deployment-state gate, deliberately separate from rbac.ts's ROUTE_RULES.
 * rbac.ts answers "which role can reach this route" (permanent, per
 * SiteOutline.md §4); this answers "is this route temporarily closed to
 * everyone right now" (a bounded launch phase). Folding the two together
 * would force isAllowed() to read process.env, breaking its current
 * pure/fixture-tested character — see rbac.test.ts.
 */
export type LaunchMode = "full" | "static_only";

export const LEGACY_BOOKING_URL = "https://www.scratchconsortium.com/alain2020/robostrar/index.php";

export function getLaunchMode(): LaunchMode {
  return process.env.LAUNCH_MODE === "static_only" ? "static_only" : "full";
}

export function isStaticOnlyLaunch(): boolean {
  return getLaunchMode() === "static_only";
}

interface StaticOnlyGate {
  pattern: string;
  redirectTo: string;
}

// First-match-wins, same convention as rbac.ts's ROUTE_RULES — /app/schedule
// must precede the general /app/* rule since it's the more specific one.
const STATIC_ONLY_GATES: StaticOnlyGate[] = [
  { pattern: "/app/schedule", redirectTo: LEGACY_BOOKING_URL },
  { pattern: "/app/*", redirectTo: "/" },
  { pattern: "/dashboard", redirectTo: "/" },
  { pattern: "/auth/register", redirectTo: "/auth/login" },
];

/**
 * Returns where to redirect `pathname` if static-only launch mode currently
 * closes it, or null if it's untouched (includes every /admin/* and /ops/*
 * route, /auth/login, and all public content routes — staff access and
 * public content are never gated by this).
 */
export function staticOnlyRedirectFor(pathname: string): string | null {
  if (getLaunchMode() !== "static_only") return null;
  const gate = STATIC_ONLY_GATES.find((g) => matchesPattern(pathname, g.pattern));
  return gate ? gate.redirectTo : null;
}
