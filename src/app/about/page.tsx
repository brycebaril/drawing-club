import { notFound } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { Markdown } from "@/components/Markdown";
import { PublicNav } from "@/components/PublicNav";

export default async function AboutPage() {
  const result = await pool.query<{ title: string; content: string }>(
    `SELECT title, content FROM static_pages WHERE slug = 'about'`,
  );
  if (result.rowCount === 0) notFound();
  const page = result.rows[0];

  return (
    <>
      <PublicNav />
      <main>
        <h1>{page.title}</h1>
        <Markdown content={page.content} />
      </main>
    </>
  );
}
