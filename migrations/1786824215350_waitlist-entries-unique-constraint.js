/**
 * Fixes a schema gap found while implementing booking (Phase 3): the
 * initial migration's Waitlist_Entries table had no uniqueness constraint,
 * so a user could join the same session's waitlist more than once —
 * duplicate broadcast emails, confusing state. Design Doc §6.4 treats
 * waitlisting as a one-time opt-in per user per session.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addConstraint("waitlist_entries", "waitlist_entries_session_id_user_id_unique", {
    unique: ["session_id", "user_id"],
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("waitlist_entries", "waitlist_entries_session_id_user_id_unique");
};
