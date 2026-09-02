/**
 * Rate-limit table for inviteMemberByEmailAction (src/app/app/wallet/actions.ts)
 * — an authenticated member can invite an unregistered email to join so a
 * shared ticket can eventually be re-shared to them. An open "send an email
 * to any address" action is a real spam vector without a limit; mirrors
 * login_attempts' sliding-window shape but keyed by sender_id only (the
 * caller is always authenticated here, no IP/anonymous-identifier fallback
 * needed, and every actually-sent invite counts — no succeeded/failed
 * distinction the way a login attempt has).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("invite_attempts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    sender_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    invited_email: { type: "varchar(255)", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("invite_attempts", ["sender_id", "created_at"]);
};

exports.down = (pgm) => {
  pgm.dropTable("invite_attempts");
};
