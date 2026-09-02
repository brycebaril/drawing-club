/**
 * Shared "how do we show a person's identity" convention, introduced
 * because the legacy migration derives every migrated member's `username`
 * from their email's local-part (e.g. `jane.smith@x.com` -> `jane.smith`) —
 * a value they never chose and don't recognize. Bare username display used
 * to be scattered across ~20 files with no fallback to display_name at all.
 *
 * Two variants, not one: `display_name` isn't unique (two members can share
 * a name), so a precision-sensitive context (audit logs, financial records,
 * "who exactly sent this") still needs the username alongside it — see
 * docs/MigrationPlan.md's own reasoning for why username can't be dropped
 * outright everywhere. A casual "who is this" context just wants the name.
 */

/** Compact — casual identification (session host, roster entry, "logged in as"). */
export function memberLabel(displayName: string | null, username: string): string {
  return displayName ?? username;
}

/** Precise — disambiguation matters (audit logs, transactions, support participants). */
export function memberLabelWithUsername(displayName: string | null, username: string): string {
  return displayName ? `${displayName} (@${username})` : `@${username}`;
}
