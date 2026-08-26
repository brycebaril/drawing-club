/**
 * First real persisted record of a CMS upload (src/lib/uploads/storage.ts) —
 * previously only a CMS_FILE_UPLOADED audit-log entry existed, with nothing
 * queryable for a "browse and reuse a previous upload" media library.
 * width/height are nullable since they're only meaningful for image content
 * types (PDF uploads leave them null).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("uploaded_files", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    key: { type: "text", notNull: true, unique: true },
    url: { type: "text", notNull: true },
    content_type: { type: "text", notNull: true },
    size_bytes: { type: "integer", notNull: true },
    original_filename: { type: "text" },
    width: { type: "integer" },
    height: { type: "integer" },
    uploaded_by: { type: "uuid", notNull: true, references: "users", onDelete: "RESTRICT" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("uploaded_files", "created_at");
};

exports.down = (pgm) => {
  pgm.dropTable("uploaded_files");
};
