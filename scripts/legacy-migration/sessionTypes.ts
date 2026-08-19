/**
 * Legacy session_types.id -> this app's session_type enum code, per
 * docs/MigrationPlan.md §6. Resolved directly with the org during planning
 * (this app's L/R/G/P/S/X/Gallery/Party codes have no documented labels
 * anywhere in the codebase, so the mapping couldn't be derived from code).
 *
 * Verified against the real legacy dump's session_types rows (id 1 is
 * genuinely absent — a gap in legacy's own data, not an oversight here).
 */
export const LEGACY_SESSION_TYPE_MAP: Record<number, "G" | "R" | "S" | "P" | "L" | "X" | null> = {
  0: "G", // gesture
  2: "R", // regular
  3: "S", // costume -> currently absorbed into Special; org may add a dedicated `C` code later
  4: "P", // portrait
  5: "L", // long pose
  6: "X", // multiday pose -> "ELP" (Extra Long Pose) in this app's own convention
  7: null, // empty (UNDEF placeholder) -> not a real session type, see resolveSessionType below
  8: "S", // special
};

/**
 * A session using the `empty` (id 7) placeholder type has no real
 * destination type of its own — per MigrationPlan.md §5's `sessions` row,
 * these still migrate as real sessions (they're genuine calendar
 * placeholders), just flagged for manual review rather than guessed at,
 * since nothing else on the row indicates what it should actually be.
 */
export function resolveSessionType(legacyTypeId: number): { code: string | null; needsReview: boolean } {
  if (!(legacyTypeId in LEGACY_SESSION_TYPE_MAP)) {
    return { code: null, needsReview: true };
  }
  const code = LEGACY_SESSION_TYPE_MAP[legacyTypeId];
  return { code, needsReview: code === null };
}
