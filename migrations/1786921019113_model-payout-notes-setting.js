/**
 * The legacy weekly payout email this feature replaces includes an
 * organization-specific e-transfer payment note (including a security
 * question/answer for the org's bank payee list). That's a real financial
 * credential — it does not belong hardcoded in source code, git history, or
 * anywhere it'd be harder to rotate than an admin-editable setting. This
 * gives admins a place to configure that text themselves (System Settings
 * store, Design Doc §12.1) rather than baking it into the payout-report code.
 * Left blank by default — the report simply omits the line if unset.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO system_settings (key, value, data_type, description)
    VALUES (
      'MODEL_PAYOUT_PAYMENT_NOTES',
      '',
      'String',
      'Optional extra payment-process note appended to the weekly model payout report email (e.g. e-transfer instructions) — set by an admin, not stored in code.'
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM system_settings WHERE key = 'MODEL_PAYOUT_PAYMENT_NOTES'`);
};
