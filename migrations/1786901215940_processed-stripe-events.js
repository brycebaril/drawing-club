/**
 * Stripe delivers webhooks at-least-once, so the same event.id can arrive
 * more than once. Without a dedup mechanism, a redelivered
 * checkout.session.completed would double-grant passes and a redelivered
 * charge.refunded would double-apply a refund. The webhook handler inserts
 * the incoming event.id here first, inside the same transaction as the rest
 * of its work; a unique-violation means "already handled," so it can bail
 * out as a no-op instead of reprocessing.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("processed_stripe_events", {
    event_id: { type: "text", primaryKey: true },
    event_type: { type: "text", notNull: true },
    processed_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
};

exports.down = (pgm) => {
  pgm.dropTable("processed_stripe_events");
};
