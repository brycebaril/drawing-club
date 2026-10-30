/**
 * Models' full names (including last name) only belong on the two screens
 * that actually need them to do the job: Model Booking (coordinates models
 * directly, src/app/ops/model-booking/*) and payment/payout surfaces (a real
 * e-transfer needs a real name — src/lib/ops/payouts.ts, /ops/financials).
 * Both read `models.name` raw and never call this module — this is
 * deliberately screen-based, not role-based: an ADMIN sees first-name-only
 * on the schedule and check-in same as everyone else, and only sees the
 * full name by being on one of those two specific screens.
 */

/** First name only, e.g. "Jane Doe" -> "Jane". */
export function truncateModelName(fullName: string): string {
  return fullName.split(" ")[0];
}

/**
 * Applies truncateModelName to a comma-joined multi-model string (this
 * app's string_agg(m.name, ', ') aggregate shape). Passes through null
 * unchanged (no model assigned yet).
 */
export function displayModelNames(names: string | null): string | null {
  if (!names) return names;
  return names
    .split(", ")
    .map(truncateModelName)
    .join(", ");
}
