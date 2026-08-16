/**
 * Design Doc §9.2 describes session creation declaring whether it needs a
 * model, multiple models, or none — but no column for that ever existed.
 * Without one, a gallery/non-model session would show as "needs attention"
 * on the /ops/model-booking matrix forever, with no way to dismiss it.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("sessions", {
    model_required: { type: "boolean", notNull: true, default: true },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("sessions", "model_required");
};
