import { notFound } from "next/navigation";
import Image from "next/image";
import { pool } from "@/lib/db/pool";
import { Markdown } from "@/components/Markdown";
import { SiteNav } from "@/components/SiteNav";

export default async function AboutPage() {
  const result = await pool.query<{ title: string; content: string }>(
    `SELECT title, content FROM static_pages WHERE slug = 'about'`,
  );
  if (result.rowCount === 0) notFound();
  const page = result.rows[0];

  return (
    <>
      <SiteNav />
      <main>
        <h1>{page.title}</h1>
        <div className="photo-frame" style={{ maxWidth: "600px" }}>
          <Image
            src="/photos/drawing-in-progress.jpg"
            alt="An artist seen from behind at their easel, red conté crayon in hand, a blank sheet of paper in front of them, and framed figure drawings hung on the wall behind."
            width={600}
            height={854}
            className="washed"
          />
        </div>
        <Markdown content={page.content} />
      </main>
    </>
  );
}
