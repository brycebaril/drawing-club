/**
 * Data-only correction, not an edit to the original seed migration
 * (1786933547683_seed-dev-stats-api-key.js) — same "new migration, don't
 * rewrite history" convention this project always follows (matches
 * 1787117348784_add-passes-members-scopes-to-dev-api-key.js's precedent).
 * Adds the three new report scopes (account_classes, account_activity,
 * ticket_circulation — previously dashboard-HTML-only, now real
 * /api/stats/* routes) to the seeded local-dev key so it keeps working
 * without a manual re-grant.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE api_keys
    SET scopes = array_cat(scopes, ARRAY['account_classes', 'account_activity', 'ticket_circulation'])
    WHERE name = 'Local dev (Claude Code)'
      AND NOT (scopes @> ARRAY['account_classes', 'account_activity', 'ticket_circulation'])
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE api_keys
    SET scopes = array_remove(array_remove(array_remove(scopes, 'account_classes'), 'account_activity'), 'ticket_circulation')
    WHERE name = 'Local dev (Claude Code)'
  `);
};
