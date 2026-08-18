/**
 * Slugs an admin-created page can never use. `home`/`about`/`contact` each
 * have their own dedicated public route and extra page-specific behavior
 * beyond a generic Markdown render (home: the upcoming-sessions list;
 * contact: the contact form) — they never render at /pages/[slug].
 * `new` is reserved for a different reason: it would collide with the
 * literal sibling route /ops/cms/pages/new (Next.js always prefers a
 * literal route segment over a dynamic [slug] one for an exact match), so
 * a page with that slug could never be reached through its own Edit link
 * again — it would silently land back on the "create a new page" form
 * instead. Found by code review, not by a report of it happening.
 */
export const RESERVED_STATIC_PAGE_SLUGS = ["home", "about", "contact", "new"];

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
