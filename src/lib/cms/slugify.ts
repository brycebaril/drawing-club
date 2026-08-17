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
