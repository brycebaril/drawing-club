/**
 * Data-only correction, not an edit to the original seed migration
 * (1786933547683_seed-dev-stats-api-key.js) — same "new migration, don't
 * rewrite history" convention this project always follows. Adds the two
 * new report scopes (reporting-overhaul Phase 1: Passes, Members) to the
 * seeded local-dev key so it keeps working without a manual re-grant.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE api_keys
    SET scopes = array_cat(scopes, ARRAY['passes', 'members'])
    WHERE name = 'Local dev (Claude Code)' AND NOT (scopes @> ARRAY['passes', 'members'])
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    UPDATE api_keys
    SET scopes = array_remove(array_remove(scopes, 'passes'), 'members')
    WHERE name = 'Local dev (Claude Code)'
  `);
};
