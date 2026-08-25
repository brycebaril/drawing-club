/**
 * Data-only wording update: the shallow user-facing rename ("pass" ->
 * "ticket" everywhere a human reads it) covers /admin/settings' rendered
 * setting descriptions too, since they're stored text, not code. The keys
 * themselves (PRICE_SINGLE_PASS_STANDARD, etc.) deliberately don't change —
 * that's the "full rename"'s concern, not this one's. New migration rather
 * than editing 1786824018361_default-system-settings.js, same "don't
 * rewrite history" convention this project already follows (e.g.
 * 1786920248611_correct-model-pay-rate.js).
 */

exports.shorthands = undefined;

const REWORDS = [
  [
    "PRICE_SINGLE_PASS_STANDARD",
    "Retail price for a single session pass for basic Account Holders.",
    "Retail price for a single session ticket for basic Account Holders.",
  ],
  [
    "PRICE_SINGLE_PASS_MEMBER",
    "Discounted single pass price for active Paid Members.",
    "Discounted single ticket price for active Paid Members.",
  ],
  [
    "PRICE_PACK_5_STANDARD",
    "Bulk 5-pass pack price for basic Account Holders ($18.00/pass).",
    "Bulk 5-ticket pack price for basic Account Holders ($18.00/ticket).",
  ],
  [
    "PRICE_PACK_5_MEMBER",
    "Bulk 5-pass pack price for active Paid Members ($15.00/pass).",
    "Bulk 5-ticket pack price for active Paid Members ($15.00/ticket).",
  ],
  [
    "PRICE_PACK_10_MEMBER",
    "Bulk 10-pass pack price for active Paid Members ($13.00/pass).",
    "Bulk 10-ticket pack price for active Paid Members ($13.00/ticket).",
  ],
  [
    "VOLUNTEER_WEEKLY_PASS_ALLOWANCE",
    "Number of complimentary passes granted weekly to eligible active volunteers.",
    "Number of complimentary tickets granted weekly to eligible active volunteers.",
  ],
  [
    "MEMBERSHIP_BONUS_PASSES",
    "Number of free transferable passes granted automatically upon annual membership purchase/renewal.",
    "Number of free transferable tickets granted automatically upon annual membership purchase/renewal.",
  ],
];

exports.up = async (pgm) => {
  for (const [key, , newDescription] of REWORDS) {
    await pgm.db.query(`UPDATE system_settings SET description = $1 WHERE key = $2`, [newDescription, key]);
  }
};

exports.down = async (pgm) => {
  for (const [key, oldDescription] of REWORDS) {
    await pgm.db.query(`UPDATE system_settings SET description = $1 WHERE key = $2`, [oldDescription, key]);
  }
};
