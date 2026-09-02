import type { Role } from "@/lib/auth/roles";

/**
 * Models' full names (including last name) are only shown to the people who
 * actually need them to do their job: the Model Booker volunteer role
 * (books/coordinates models directly) and Admins (full visibility
 * everywhere, per this app's general pattern). Everyone else — guests,
 * ordinary members, hosts, other volunteer roles — sees first name only.
 *
 * Deliberately excludes VOL_CTRL from this general rule even though the
 * weekly payout report (src/lib/ops/payouts.ts) legitimately shows full
 * names to Controllers too — that's a narrower, payment-specific need (a
 * real e-transfer needs a real name), handled locally in that report rather
 * than by broadening this general-purpose check.
 */
export function canSeeFullModelName(roles: Role[] | null): boolean {
  return !!roles && (roles.includes("ADMIN") || roles.includes("VOL_MBR"));
}

/** First name only, e.g. "Jane Doe" -> "Jane". */
export function truncateModelName(fullName: string): string {
  return fullName.split(" ")[0];
}

/**
 * Applies truncateModelName to a comma-joined multi-model string (this
 * app's string_agg(m.name, ', ') aggregate shape) unless the viewer can see
 * full names. Passes through null unchanged (no model assigned yet).
 */
export function displayModelNames(names: string | null, roles: Role[] | null): string | null {
  if (!names) return names;
  if (canSeeFullModelName(roles)) return names;
  return names
    .split(", ")
    .map(truncateModelName)
    .join(", ");
}
