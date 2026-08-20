/**
 * Member-facing support-ticket system (see the SupportAgent volunteer role
 * added in the companion migration). Separate from the public /contact form
 * (unauthenticated, fire-and-forget email, no persistence) — this is a real
 * reply thread tied to a logged-in member's account.
 *
 * last_message_at/last_message_by_user_id are denormalized onto the ticket
 * row (rather than derived via a join/subquery on support_ticket_messages
 * every time) specifically so "needs staff reply"
 * (status = 'Open' AND last_message_by_user_id = requester_user_id) and
 * "needs member reply" (status = 'Open' AND last_message_by_user_id !=
 * requester_user_id) are cheap single-row checks — used on the inbox sort,
 * the member's notification banner, and the staff nav badge count.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType("support_ticket_status", ["Open", "Resolved"]);

  pgm.createTable("support_tickets", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    requester_user_id: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    subject: { type: "varchar(255)", notNull: true },
    status: { type: "support_ticket_status", notNull: true, default: "Open" },
    last_message_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    last_message_by_user_id: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("support_tickets", ["status", "last_message_at"]);
  pgm.createIndex("support_tickets", "requester_user_id");

  pgm.createTable("support_ticket_messages", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    ticket_id: { type: "uuid", notNull: true, references: "support_tickets", onDelete: "CASCADE" },
    author_user_id: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    content: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("support_ticket_messages", "ticket_id");
};

exports.down = (pgm) => {
  pgm.dropTable("support_ticket_messages");
  pgm.dropTable("support_tickets");
  pgm.dropType("support_ticket_status");
};
