/**
 * Fixes a schema gap found while implementing recurring session creation
 * (Phase 5): `frequency` was a vague placeholder string with nothing
 * actually encoding what time of day a session occurs. No app code reads
 * `frequency` yet, so this is a clean replacement, not a breaking change.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.dropColumn("recurrence_rules", "frequency");
  pgm.addColumns("recurrence_rules", {
    // 0=Sunday..6=Saturday, matching JS Date.getDay().
    day_of_week: { type: "smallint", notNull: true },
    start_time_of_day: { type: "time", notNull: true },
    end_time_of_day: { type: "time", notNull: true },
    max_capacity: { type: "integer" },
    description: { type: "text" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("recurrence_rules", [
    "day_of_week",
    "start_time_of_day",
    "end_time_of_day",
    "max_capacity",
    "description",
  ]);
  pgm.addColumn("recurrence_rules", {
    frequency: { type: "varchar(255)" },
  });
};
