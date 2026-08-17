import { notFound } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { OpsNav } from "@/components/OpsNav";
import { NewsPostForm } from "../NewsPostForm";
import { toDateOnly } from "@/lib/sessions/shared";

interface NewsPostRow {
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  image_url: string | null;
  status: "Draft" | "Published";
  publish_date: Date;
}

export default async function EditNewsPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ctx = await requireOpsRole(["VOL_MKT"]);
  if (!ctx) notFound();

  const result = await pool.query<NewsPostRow>(
    `SELECT title, slug, excerpt, content, image_url, status, publish_date FROM news_posts WHERE id = $1`,
    [id],
  );
  if (result.rowCount === 0) notFound();
  const post = result.rows[0];

  return (
    <main>
      <OpsNav roles={ctx.roles} />
      <h1>Edit post</h1>
      <NewsPostForm
        mode="edit"
        postId={id}
        initial={{
          title: post.title,
          slug: post.slug,
          excerpt: post.excerpt ?? "",
          content: post.content,
          imageUrl: post.image_url ?? "",
          status: post.status,
          publishDate: toDateOnly(new Date(post.publish_date)),
        }}
      />
    </main>
  );
}
