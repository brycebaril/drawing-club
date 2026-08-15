/**
 * Initial schema migration — transcribes DesignDocument.md §13's draft data
 * models into real PostgreSQL DDL. Table/column names and semantics should
 * match that doc; if they diverge, the doc (or this migration) needs fixing,
 * not silent redesign here.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // --- Enum types ---
  pgm.createType("setting_data_type", ["Decimal", "Integer", "Boolean", "String"]);
  pgm.createType("base_role", ["AccountHolder", "Admin"]);
  pgm.createType("account_status", ["Active", "Suspended", "Banned"]);
  pgm.createType("volunteer_role_name", [
    "SessionManager",
    "ContentEditor",
    "ModelBooker",
    "Controller",
  ]);
  pgm.createType("session_type", ["L", "R", "G", "P", "S", "X", "Gallery", "Party"]);
  pgm.createType("session_status", ["Scheduled", "Canceled"]);
  pgm.createType("charge_status", ["Succeeded", "Failed", "Refunded", "Disputed"]);
  pgm.createType("payout_status", ["Pending", "Paid_Out"]);
  pgm.createType("transaction_item_type", ["SinglePass", "PassPack", "MembershipRenewal"]);
  pgm.createType("pass_status", ["Available", "Assigned", "Used", "Revoked"]);

  // --- Users & Accounts (Design Doc §13) ---
  pgm.createTable("users", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    username: { type: "varchar(255)", notNull: true, unique: true },
    password_hash: { type: "varchar(255)", notNull: true },
    email: { type: "varchar(255)", notNull: true },
    email_verified_at: { type: "timestamptz" },
    base_role: { type: "base_role", notNull: true, default: "AccountHolder" },
    mfa_enabled: { type: "boolean", notNull: true, default: false },
    membership_expires_at: { type: "timestamptz" },
    status: { type: "account_status", notNull: true, default: "Active" },
  });
  pgm.createIndex("users", "email");

  // --- Models & Assignments (§13) ---
  pgm.createTable("models", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    legacy_id: { type: "varchar(255)" },
    name: { type: "varchar(255)", notNull: true },
    contact_info: { type: "varchar(255)" },
  });

  // --- System Settings / Config (§13) ---
  pgm.createTable("system_settings", {
    key: { type: "varchar(255)", primaryKey: true },
    value: { type: "text", notNull: true },
    data_type: { type: "setting_data_type", notNull: true },
    description: { type: "text" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid", references: "users", onDelete: "SET NULL" },
  });

  // --- Recurrence Rules (§13, backs Design Doc §9.2's Recurring Standard Sessions) ---
  pgm.createTable("recurrence_rules", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    session_type: { type: "session_type", notNull: true },
    frequency: { type: "varchar(255)", notNull: true },
    default_host_user_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    start_date: { type: "date", notNull: true },
    end_date: { type: "date" },
    superseded_by_rule_id: { type: "uuid" },
    created_by: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
  });
  pgm.addConstraint("recurrence_rules", "recurrence_rules_superseded_by_rule_id_fkey", {
    foreignKeys: {
      columns: "superseded_by_rule_id",
      references: "recurrence_rules(id)",
      onDelete: "SET NULL",
    },
  });

  // --- Sessions (§13) ---
  // series_id is a plain grouping key shared by all sessions in a Multi-Week
  // Series (Design Doc §6.5) — the draft schema has no separate Series table
  // to reference, so it's intentionally not a foreign key.
  pgm.createTable("sessions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    series_id: { type: "uuid" },
    recurrence_rule_id: {
      type: "uuid",
      references: "recurrence_rules",
      onDelete: "SET NULL",
    },
    status: { type: "session_status", notNull: true, default: "Scheduled" },
    session_type: { type: "session_type", notNull: true },
    description: { type: "text" },
    start_time: { type: "timestamptz", notNull: true },
    end_time: { type: "timestamptz", notNull: true },
    max_capacity: { type: "integer", notNull: true, default: 25 },
    is_ticketed: { type: "boolean", notNull: true, default: true },
    host_user_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
  });
  pgm.createIndex("sessions", "series_id");
  pgm.createIndex("sessions", "recurrence_rule_id");
  pgm.createIndex("sessions", "start_time");

  // --- Volunteer Roles (join table, §13) ---
  pgm.createTable("volunteer_roles", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    role: { type: "volunteer_role_name", notNull: true },
    assigned_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    assigned_by: { type: "uuid", references: "users", onDelete: "SET NULL" },
  });
  pgm.addConstraint("volunteer_roles", "volunteer_roles_user_id_role_unique", {
    unique: ["user_id", "role"],
  });

  // --- Transactions / Orders (§13) ---
  pgm.createTable("transactions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    gateway_ref_id: { type: "varchar(255)", notNull: true },
    amount_paid: { type: "numeric(10,2)", notNull: true },
    processing_fee: { type: "numeric(10,2)" },
    net_amount: { type: "numeric(10,2)" },
    charge_status: { type: "charge_status", notNull: true },
    refunded_amount: { type: "numeric(10,2)" },
    payout_batch_id: { type: "varchar(255)" },
    payout_status: { type: "payout_status", notNull: true, default: "Pending" },
    item_type: { type: "transaction_item_type", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("transactions", "user_id");
  pgm.createIndex("transactions", "payout_batch_id");

  // --- Membership History (§13) ---
  pgm.createTable("membership_history", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    transaction_id: { type: "uuid", references: "transactions", onDelete: "SET NULL" },
    valid_from: { type: "timestamptz", notNull: true },
    valid_until: { type: "timestamptz", notNull: true },
    granted_by: { type: "uuid", references: "users", onDelete: "SET NULL" },
  });
  pgm.createIndex("membership_history", "user_id");

  // --- Pass Batches (§13, Design Doc §6.2 institutional/bulk passes) ---
  pgm.createTable("pass_batches", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    organization_name: { type: "varchar(255)", notNull: true },
    quantity: { type: "integer", notNull: true },
    transaction_id: { type: "uuid", references: "transactions", onDelete: "SET NULL" },
    created_by: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // --- Passes (§13) ---
  pgm.createTable("passes", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    owner_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    session_id: { type: "uuid", references: "sessions", onDelete: "SET NULL" },
    checked_in: { type: "boolean", notNull: true, default: false },
    transaction_id: { type: "uuid", references: "transactions", onDelete: "SET NULL" },
    batch_id: { type: "uuid", references: "pass_batches", onDelete: "SET NULL" },
    is_transferable: { type: "boolean", notNull: true, default: false },
    status: { type: "pass_status", notNull: true, default: "Available" },
    sender_user_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    claim_code: { type: "varchar(255)" },
    claim_note: { type: "text" },
    claimed_at: { type: "timestamptz" },
    effective_price: { type: "numeric(10,2)", notNull: true },
  });
  pgm.createIndex("passes", "owner_id");
  pgm.createIndex("passes", "session_id");
  pgm.createIndex("passes", "batch_id");
  pgm.createIndex("passes", "claim_code", { unique: true, where: "claim_code IS NOT NULL" });

  // --- Seat Reservations (§13, Multi-Week Series) ---
  pgm.createTable("seat_reservations", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    session_id: { type: "uuid", notNull: true, references: "sessions", onDelete: "CASCADE" },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    pass_id: { type: "uuid", notNull: true, references: "passes", onDelete: "RESTRICT" },
    seat_number: { type: "integer", notNull: true },
    checked_in: { type: "boolean", notNull: true, default: false },
  });
  pgm.createIndex("seat_reservations", "session_id");
  pgm.createIndex("seat_reservations", "user_id");

  // --- Waitlist Entries (§13) ---
  pgm.createTable("waitlist_entries", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    session_id: { type: "uuid", notNull: true, references: "sessions", onDelete: "CASCADE" },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    notified_at: { type: "timestamptz" },
  });
  pgm.createIndex("waitlist_entries", "session_id");

  // --- Session Notes / Operational Log (§13) ---
  pgm.createTable("session_notes", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    session_id: { type: "uuid", notNull: true, references: "sessions", onDelete: "CASCADE" },
    author_user_id: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    content: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("session_notes", "session_id");

  // --- Session_Model_Mapping (join table, §13) ---
  pgm.createTable("session_model_mapping", {
    session_id: { type: "uuid", notNull: true, references: "sessions", onDelete: "CASCADE" },
    model_id: { type: "uuid", notNull: true, references: "models", onDelete: "CASCADE" },
  });
  pgm.addConstraint("session_model_mapping", "session_model_mapping_pkey", {
    primaryKey: ["session_id", "model_id"],
  });

  // --- Model Payout Reports (§13) ---
  pgm.createTable("model_payout_reports", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    model_id: { type: "uuid", notNull: true, references: "models", onDelete: "RESTRICT" },
    week_start_date: { type: "date", notNull: true },
    week_end_date: { type: "date", notNull: true },
    sessions_worked: { type: "integer", notNull: true },
    rate_applied: { type: "numeric(10,2)", notNull: true },
    total_owed: { type: "numeric(10,2)", notNull: true },
    generated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("model_payout_reports", "model_id");

  // --- System Audit Logs (§13) ---
  pgm.createTable("system_audit_logs", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    actor_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    action_type: { type: "varchar(255)", notNull: true },
    target_user_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    metadata: { type: "jsonb" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("system_audit_logs", "actor_id");
  pgm.createIndex("system_audit_logs", "target_user_id");
  pgm.createIndex("system_audit_logs", "action_type");
};

exports.down = (pgm) => {
  pgm.dropTable("system_audit_logs");
  pgm.dropTable("model_payout_reports");
  pgm.dropTable("session_model_mapping");
  pgm.dropTable("session_notes");
  pgm.dropTable("waitlist_entries");
  pgm.dropTable("seat_reservations");
  pgm.dropTable("passes");
  pgm.dropTable("pass_batches");
  pgm.dropTable("membership_history");
  pgm.dropTable("transactions");
  pgm.dropTable("volunteer_roles");
  pgm.dropTable("sessions");
  pgm.dropTable("recurrence_rules");
  pgm.dropTable("system_settings");
  pgm.dropTable("models");
  pgm.dropTable("users");

  pgm.dropType("pass_status");
  pgm.dropType("transaction_item_type");
  pgm.dropType("payout_status");
  pgm.dropType("charge_status");
  pgm.dropType("session_status");
  pgm.dropType("session_type");
  pgm.dropType("volunteer_role_name");
  pgm.dropType("account_status");
  pgm.dropType("base_role");
  pgm.dropType("setting_data_type");
};
