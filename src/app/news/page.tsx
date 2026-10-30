import Image from "next/image";
import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { ORG_TIMEZONE } from "@/lib/org";

interface NewsListRow {
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  image_url: string | null;
  publish_date: Date;
}

function teaser(post: NewsListRow): string {
  if (post.excerpt) return post.excerpt;
  const plain = post.content.replace(/[#*_`>[\]]/g, "").trim();
  return plain.length > 200 ? `${plain.slice(0, 200)}…` : plain;
}

export default async function NewsListPage() {
  const result = await pool.query<NewsListRow>(
    `SELECT slug, title, excerpt, content, image_url, publish_date
     FROM news_posts WHERE status = 'Published' ORDER BY publish_date DESC`,
  );

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
        <h1>News</h1>
        {result.rowCount === 0 ? (
          <p>No news yet.</p>
        ) : (
          <ul>
            {result.rows.map((post) => (
              <li key={post.slug}>
                {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external URL (CMS images decision: URL field only, no next/image remotePatterns to configure) */}
                {post.image_url && <img src={post.image_url} alt="" width={120} />}
                <h2>
                  <Link href={`/news/${post.slug}`}>{post.title}</Link>
                </h2>
                <p>{new Date(post.publish_date).toLocaleDateString("en-US", { timeZone: ORG_TIMEZONE })}</p>
                <p>{teaser(post)}</p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
