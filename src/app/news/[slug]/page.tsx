import { notFound } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { Markdown } from "@/components/Markdown";
import { SiteNav } from "@/components/SiteNav";

interface NewsPostRow {
  title: string;
  content: string;
  image_url: string | null;
  publish_date: Date;
}

export default async function NewsPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const result = await pool.query<NewsPostRow>(
    `SELECT title, content, image_url, publish_date FROM news_posts WHERE slug = $1 AND status = 'Published'`,
    [slug],
  );
  if (result.rowCount === 0) notFound();
  const post = result.rows[0];

  return (
    <>
      <SiteNav />
      <main>
        <h1>{post.title}</h1>
        <p>{new Date(post.publish_date).toLocaleDateString()}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external URL (CMS images decision: URL field only, no next/image remotePatterns to configure) */}
        {post.image_url && <img src={post.image_url} alt="" />}
        <Markdown content={post.content} />
      </main>
    </>
  );
}
