import { notFound } from "next/navigation";
import Image from "next/image";
import { pool } from "@/lib/db/pool";
import { Markdown } from "@/components/Markdown";
import { SiteNav } from "@/components/SiteNav";
import { ORG_TIMEZONE } from "@/lib/org";

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
        <div className="photo-frame">
          <Image
            src="/photos/exhibition-wall.jpg"
            alt="The studio's exhibition wall: framed paintings and drawings hung salon-style beside the studio door, with a FIGURATIVE ART EXHIBITION poster."
            width={1200}
            height={1544}
            className="washed washed--warm"
          />
        </div>
        <h1>{post.title}</h1>
        <p>{new Date(post.publish_date).toLocaleDateString("en-US", { timeZone: ORG_TIMEZONE })}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external URL (CMS images decision: URL field only, no next/image remotePatterns to configure) */}
        {post.image_url && <img src={post.image_url} alt="" />}
        <Markdown content={post.content} />
      </main>
    </>
  );
}
