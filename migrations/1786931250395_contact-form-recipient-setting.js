/**
 * The public /contact form needs somewhere to send messages. The recipient
 * is real organizational contact info, not something to hardcode — same
 * "settings-store, not a literal" reasoning as MODEL_PAYOUT_PAYMENT_NOTES.
 * Left blank by default; the form fails with a generic error until an admin
 * sets it via the System Settings store (Design Doc §12.1).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    INSERT INTO system_settings (key, value, data_type, description)
    VALUES (
      'CONTACT_FORM_RECIPIENT_EMAIL',
      '',
      'String',
      'Recipient address for the public /contact form — set by an admin, not stored in code.'
    )
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM system_settings WHERE key = 'CONTACT_FORM_RECIPIENT_EMAIL'`);
};
