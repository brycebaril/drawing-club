/**
 * Replaces claim-code-based pass gifting with direct owner-to-owner
 * transfers (share -> recipient accepts/declines from their own wallet).
 * Every pass keeps a real owner_id at all times, even during a pending
 * transfer — pending_recipient_id records who it's currently offered to,
 * rather than nulling owner_id out the way the claim-code flow did.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("passes", {
    pending_recipient_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    share_note: { type: "text" },
  });

  pgm.sql(`UPDATE passes SET share_note = claim_note WHERE claim_note IS NOT NULL`);

  pgm.dropColumn("passes", ["claim_code", "claim_note", "claimed_at"]);
};

exports.down = (pgm) => {
  pgm.addColumn("passes", {
    claim_code: { type: "varchar(255)" },
    claim_note: { type: "text" },
    claimed_at: { type: "timestamptz" },
  });
  pgm.createIndex("passes", "claim_code", { unique: true, where: "claim_code IS NOT NULL" });

  pgm.sql(`UPDATE passes SET claim_note = share_note WHERE share_note IS NOT NULL`);

  pgm.dropColumn("passes", ["pending_recipient_id", "share_note"]);
};
