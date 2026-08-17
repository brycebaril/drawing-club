"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { pool } from "@/lib/db/pool";
import { writeAuditLog } from "@/lib/audit/log";
import { slugify } from "@/lib/cms/slugify";

export interface NewsPostFormState {
  error?: string;
}

interface ParsedFields {
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  imageUrl: string | null;
  status: "Draft" | "Published";
  publishDate: string;
}

function parseFields(formData: FormData): ParsedFields | { error: string } {
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!title || !content) {
    return { error: "Title and content are both required." };
  }

  const rawSlug = String(formData.get("slug") ?? "").trim();
  const slug = rawSlug ? slugify(rawSlug) : slugify(title);
  if (!slug) {
    return { error: "Couldn't derive a slug from that title — add one manually." };
  }

  const excerpt = String(formData.get("excerpt") ?? "").trim() || null;
  const imageUrl = String(formData.get("imageUrl") ?? "").trim() || null;
  const status = formData.get("status") === "Published" ? "Published" : "Draft";
  const publishDate = String(formData.get("publishDate") ?? "").trim();
  if (!publishDate) {
    return { error: "Publish date is required." };
  }

  return { title, slug, excerpt, content, imageUrl, status, publishDate };
}

export async function createNewsPostAction(
  _prevState: NewsPostFormState,
  formData: FormData,
): Promise<NewsPostFormState> {
  const ctx = await requireOpsRole(["VOL_MKT"]);
  if (!ctx) return { error: "Not authorized." };

  const fields = parseFields(formData);
  if ("error" in fields) return fields;

  let postId: string;
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO news_posts (slug, title, excerpt, content, image_url, status, publish_date, author_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        fields.slug,
        fields.title,
        fields.excerpt,
        fields.content,
        fields.imageUrl,
        fields.status,
        fields.publishDate,
        ctx.id,
      ],
    );
    postId = result.rows[0].id;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "That slug is already in use — try a different one." };
    }
    throw error;
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "CMS_NEWS_POST_CREATED",
    metadata: { postId, slug: fields.slug, status: fields.status },
  });

  revalidatePath("/ops/cms");
  revalidatePath("/news");
  redirect(`/ops/cms/news/${postId}`);
}

export async function updateNewsPostAction(
  _prevState: NewsPostFormState,
  formData: FormData,
): Promise<NewsPostFormState> {
  const ctx = await requireOpsRole(["VOL_MKT"]);
  if (!ctx) return { error: "Not authorized." };

  const postId = String(formData.get("postId") ?? "");
  const fields = parseFields(formData);
  if ("error" in fields) return fields;

  try {
    const updated = await pool.query(
      `UPDATE news_posts
       SET slug = $1, title = $2, excerpt = $3, content = $4, image_url = $5,
           status = $6, publish_date = $7, updated_at = now()
       WHERE id = $8`,
      [
        fields.slug,
        fields.title,
        fields.excerpt,
        fields.content,
        fields.imageUrl,
        fields.status,
        fields.publishDate,
        postId,
      ],
    );
    if (updated.rowCount === 0) {
      return { error: "That post doesn't exist." };
    }
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "That slug is already in use — try a different one." };
    }
    throw error;
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "CMS_NEWS_POST_UPDATED",
    metadata: { postId, slug: fields.slug, status: fields.status },
  });

  revalidatePath("/ops/cms");
  revalidatePath("/news");
  revalidatePath(`/news/${fields.slug}`);
  redirect(`/ops/cms/news/${postId}`);
}
