/**
 * Fixes a gap found in a holistic code review: pass selection at booking
 * time is commented "FIFO: oldest available pass first" but has always
 * ordered by `passes.id` — a random gen_random_uuid() with no chronological
 * meaning, since the table had no creation-time column to order by instead.
 * Since `effective_price` is recorded per-pass at grant time specifically
 * for yield/ROI accounting (CLAUDE.md), which pass gets consumed first
 * actually matters for that reporting, not just cosmetically.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn("passes", {
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("passes", ["owner_id", "status", "created_at"]);
};

exports.down = (pgm) => {
  pgm.dropColumn("passes", "created_at");
};
