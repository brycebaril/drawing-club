import { notFound } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { Markdown } from "@/components/Markdown";
import { SiteNav } from "@/components/SiteNav";
import { RESERVED_STATIC_PAGE_SLUGS } from "@/lib/cms/slugify";

/**
 * Generic renderer for any admin-created static_pages row. home/about/
 * contact each have their own dedicated route (and do more than a plain
 * Markdown render — home has the upcoming-sessions list, contact has the
 * contact form) and never render here, to keep one canonical URL per page.
 */
export default async function StaticPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (RESERVED_STATIC_PAGE_SLUGS.includes(slug)) notFound();

  const result = await pool.query<{ title: string; content: string }>(
    `SELECT title, content FROM static_pages WHERE slug = $1`,
    [slug],
  );
  if (result.rowCount === 0) notFound();
  const page = result.rows[0];

  return (
    <>
      <SiteNav />
      <main>
        <h1>{page.title}</h1>
        <Markdown content={page.content} />
      </main>
    </>
  );
}
