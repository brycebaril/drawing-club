import { notFound } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { SiteNav } from "@/components/SiteNav";
import { StaticPageForm } from "./StaticPageForm";

interface StaticPageRow {
  title: string;
  content: string;
}

export default async function EditStaticPagePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const ctx = await requireOpsRole(["VOL_MKT"]);
  if (!ctx) notFound();

  const result = await pool.query<StaticPageRow>(
    `SELECT title, content FROM static_pages WHERE slug = $1`,
    [slug],
  );
  if (result.rowCount === 0) notFound();
  const page = result.rows[0];

  return (
    <>
      <SiteNav />
      <main>
      <h1>Edit page: {slug}</h1>
      <StaticPageForm slug={slug} initialTitle={page.title} initialContent={page.content} />
    </main>
    </>
  );
}
