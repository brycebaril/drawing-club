/**
 * CMS schema (Design Doc §8, SiteOutline §3.1/§3.3) — unlike every prior
 * phase, no schema for this existed anywhere in the initial migration.
 *
 * static_pages backs About/Contact/Home editorial copy; seeded here with
 * placeholder rows (not in scripts/seed.ts) because these are real public
 * routes that need a row to render in production, not dev-only fixtures —
 * an admin/VOL_MKT overwrites the placeholder via /ops/cms post-deploy.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType("news_post_status", ["Draft", "Published"]);

  pgm.createTable("static_pages", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    slug: { type: "varchar(255)", notNull: true, unique: true },
    title: { type: "varchar(255)", notNull: true },
    content: { type: "text", notNull: true },
    updated_by: { type: "uuid", references: "users", onDelete: "SET NULL" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("news_posts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    slug: { type: "varchar(255)", notNull: true, unique: true },
    title: { type: "varchar(255)", notNull: true },
    excerpt: { type: "text" },
    content: { type: "text", notNull: true },
    image_url: { type: "text" },
    status: { type: "news_post_status", notNull: true, default: "Draft" },
    publish_date: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    author_id: { type: "uuid", references: "users", onDelete: "SET NULL" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("news_posts", ["status", "publish_date"]);

  pgm.sql(`
    INSERT INTO static_pages (slug, title, content) VALUES
      ('about', 'About Us', '# About Us

Content coming soon — edit this page via /ops/cms.'),
      ('contact', 'Contact', '# Contact

Content coming soon — edit this page via /ops/cms.'),
      ('home', 'Welcome', 'Content coming soon — edit this page via /ops/cms.')
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("news_posts");
  pgm.dropTable("static_pages");
  pgm.dropType("news_post_status");
};
