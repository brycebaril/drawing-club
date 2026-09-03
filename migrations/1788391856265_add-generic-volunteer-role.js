/**
 * Real legacy source data exists for this (owned_passes/owned_entitlements
 * rows carrying volunteer_status — Studio Coordinator, Cleaner, Gallery
 * Coordinator, Social Media Coordinator, etc.), it just never mapped to any
 * RBAC role this app defines, since these were always labor compensation in
 * the legacy system too, not an access role. Per the org's direction: one
 * generic role now (to be split into specific roles later as they're
 * defined) rather than leaving these people with no role at all, which is
 * scripts/legacy-migration/rolesAndMembership.ts's actual behavior today.
 *
 * Deliberately NOT added to VOLUNTEER_ROLE_MAP (src/lib/auth/roles.ts,
 * src/lib/users/filterUsers.ts) — grants no RBAC access, same as how Board
 * carries no distinct VOL_* code (its access comes from base_role='Admin'
 * instead, a separate path). Same addTypeValue precedent as
 * 1787094908334_add-board-volunteer-role.js.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addTypeValue("volunteer_role_name", "GenericVolunteer");
};

exports.down = (_pgm) => {
  // Postgres has no DROP VALUE for enums short of recreating the type, which
  // risks failing outright if any row already holds 'GenericVolunteer' —
  // left as a no-op, same as this project's other irreversible-in-practice
  // migrations (see 1786901608328_payout-status-failed.js).
};
