import { notFound } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { Markdown } from "@/components/Markdown";
import { SiteNav } from "@/components/SiteNav";
import { ContactForm } from "./ContactForm";

export default async function ContactPage() {
  const result = await pool.query<{ title: string; content: string }>(
    `SELECT title, content FROM static_pages WHERE slug = 'contact'`,
  );
  if (result.rowCount === 0) notFound();
  const page = result.rows[0];

  return (
    <>
      <SiteNav />
      <main>
        <h1>{page.title}</h1>
        <Markdown content={page.content} />
        <h2>Send us a message</h2>
        <ContactForm />
      </main>
    </>
  );
}
