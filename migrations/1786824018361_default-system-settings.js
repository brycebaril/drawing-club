/**
 * Data migration: seeds the default System Settings rows from
 * DesignDocument.md §12.1. Values are stored as text per the schema
 * (Design Doc §13 System Settings table) and parsed per data_type by
 * src/lib/settings.ts.
 */

exports.shorthands = undefined;

const DEFAULTS = [
  ["PRICE_SINGLE_PASS_STANDARD", "20.00", "Decimal", "Retail price for a single session pass for basic Account Holders."],
  ["PRICE_SINGLE_PASS_MEMBER", "17.00", "Decimal", "Discounted single pass price for active Paid Members."],
  ["PRICE_PACK_5_STANDARD", "90.00", "Decimal", "Bulk 5-pass pack price for basic Account Holders ($18.00/pass)."],
  ["PRICE_PACK_5_MEMBER", "75.00", "Decimal", "Bulk 5-pass pack price for active Paid Members ($15.00/pass)."],
  ["PRICE_PACK_10_MEMBER", "130.00", "Decimal", "Bulk 10-pass pack price for active Paid Members ($13.00/pass)."],
  ["MEMBERSHIP_ANNUAL_FEE", "60.00", "Decimal", "Standard annual membership renewal fee."],
  ["CANCELLATION_CUTOFF_HOURS", "24", "Integer", "Hours before session start time where bookings lock and become non-cancelable."],
  ["BOOKING_WINDOW_ACCOUNT_DAYS", "14", "Integer", "How many days into the future basic Account Holders can view and book sessions."],
  ["BOOKING_WINDOW_MEMBER_DAYS", "30", "Integer", "How many days into the future Paid Members can view and book sessions."],
  ["SESSION_DEFAULT_CAPACITY", "25", "Integer", "Default maximum capacity assigned when creating a new session."],
  ["MODEL_FLAT_PAY_RATE", "60.00", "Decimal", "Flat payment rate per session worked, used to calculate weekly Controller payout reports."],
  ["VOLUNTEER_WEEKLY_PASS_ALLOWANCE", "1", "Integer", "Number of complimentary passes granted weekly to eligible active volunteers."],
  ["MEMBERSHIP_BONUS_PASSES", "2", "Integer", "Number of free transferable passes granted automatically upon annual membership purchase/renewal."],
];

exports.up = async (pgm) => {
  for (const [key, value, dataType, description] of DEFAULTS) {
    await pgm.db.query(
      `INSERT INTO system_settings (key, value, data_type, description)
       VALUES ($1, $2, $3, $4)`,
      [key, value, dataType, description],
    );
  }
};

exports.down = async (pgm) => {
  await pgm.db.query(`DELETE FROM system_settings WHERE key = ANY($1)`, [
    DEFAULTS.map(([key]) => key),
  ]);
};
