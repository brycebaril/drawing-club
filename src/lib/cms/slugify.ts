/**
 * The 3 static_pages rows with their own dedicated public route and extra
 * page-specific behavior beyond a generic Markdown render (home: the
 * upcoming-sessions list; contact: the contact form). Admin-created pages
 * can't use these slugs, and never render at /pages/[slug] — they already
 * have their real URL.
 */
export const RESERVED_STATIC_PAGE_SLUGS = ["home", "about", "contact"];

/** Where a static_pages row actually renders publicly — see the reserved-slugs note above. */
export function publicPathForStaticPage(slug: string): string {
  if (slug === "home") return "/";
  if (RESERVED_STATIC_PAGE_SLUGS.includes(slug)) return `/${slug}`;
  return `/pages/${slug}`;
}

/**
 * Derives a URL-safe slug from a news post title. Uniqueness is enforced by
 * the DB's unique constraint on news_posts.slug — callers catch Postgres
 * 23505 the same way bookSeriesSeat/assignModelAction already do, this
 * function only produces the candidate string.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics left by NFKD (e.g. café -> cafe)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
