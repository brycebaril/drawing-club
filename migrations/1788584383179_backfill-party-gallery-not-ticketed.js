/**
 * sessions.is_ticketed has existed since the initial schema migration but
 * was a fully dead column — every creation path hardcoded it to `true`
 * regardless of session_type. Now that Gallery Hours/Party sessions are
 * wired up as free, ticket-free announcements (src/lib/sessions/shared.ts's
 * sessionTypeIsTicketed), existing rows created before this fix still say
 * `true` and need a one-time correction. series_id IS NULL preserves this
 * feature's own scope boundary: a multi-week series stays always-ticketed
 * regardless of session_type, so an (unlikely) existing Party/Gallery
 * series session is left untouched. Data-only correction, not an edit to
 * the original schema migration — same "new migration, don't rewrite
 * history" convention this project already follows.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(
    `UPDATE sessions SET is_ticketed = false WHERE session_type IN ('Gallery', 'Party') AND series_id IS NULL`,
  );
};

exports.down = (pgm) => {
  pgm.sql(
    `UPDATE sessions SET is_ticketed = true WHERE session_type IN ('Gallery', 'Party') AND series_id IS NULL`,
  );
};
