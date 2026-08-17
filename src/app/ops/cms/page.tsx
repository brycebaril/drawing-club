import Link from "next/link";
import { notFound } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { OpsNav } from "@/components/OpsNav";

interface StaticPageRow {
  slug: string;
  title: string;
  updated_at: Date;
}

interface NewsPostRow {
  id: string;
  slug: string;
  title: string;
  status: "Draft" | "Published";
  publish_date: Date;
}

export default async function CmsDashboardPage() {
  const ctx = await requireOpsRole(["VOL_MKT"]);
  if (!ctx) notFound();

  const pagesResult = await pool.query<StaticPageRow>(
    `SELECT slug, title, updated_at FROM static_pages ORDER BY slug`,
  );
  const postsResult = await pool.query<NewsPostRow>(
    `SELECT id, slug, title, status, publish_date FROM news_posts ORDER BY publish_date DESC`,
  );

  return (
    <main>
      <OpsNav roles={ctx.roles} />
      <h1>CMS</h1>

      <h2>Static pages</h2>
      <table>
        <thead>
          <tr>
            <th>Page</th>
            <th>Title</th>
            <th>Last updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pagesResult.rows.map((page) => (
            <tr key={page.slug}>
              <td>{page.slug}</td>
              <td>{page.title}</td>
              <td>{new Date(page.updated_at).toLocaleString()}</td>
              <td>
                <Link href={`/ops/cms/pages/${page.slug}`}>Edit</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>News posts</h2>
      <p>
        <Link href="/ops/cms/news/new">New post</Link>
      </p>
      {postsResult.rowCount === 0 ? (
        <p>No posts yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Publish date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {postsResult.rows.map((post) => (
              <tr key={post.id}>
                <td>{post.title}</td>
                <td>{post.status}</td>
                <td>{new Date(post.publish_date).toLocaleDateString()}</td>
                <td>
                  <Link href={`/ops/cms/news/${post.id}`}>Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
