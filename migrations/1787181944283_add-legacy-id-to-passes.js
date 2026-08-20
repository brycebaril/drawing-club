/**
 * Code-review finding: passesReport.ts's origin classification (legacy vs.
 * stripe vs. batch vs. admin_grant) relies on p.transaction_id/p.batch_id,
 * but migratePasses (the numTickets-balance conversion) deliberately never
 * sets transaction_id — CLAUDE.md documents why: "they don't correspond to
 * one specific historical purchase, and forcing a link to an arbitrary one
 * of the user's several orders would misrepresent the data." Every one of
 * those passes was falling into the 'admin_grant' bucket instead, silently
 * indistinguishable from a real manual admin grant.
 *
 * Fixes this at the source rather than reversing that documented decision:
 * legacy_id mirrors the existing users.legacy_id/models.legacy_id
 * precedent — a real, honest "this came from the legacy migration" marker
 * that doesn't pretend to link to one specific transaction.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("passes", {
    legacy_id: { type: "varchar(255)" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("passes", "legacy_id");
};
