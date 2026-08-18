"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { pool } from "@/lib/db/pool";
import { writeAuditLog } from "@/lib/audit/log";
import { slugify, RESERVED_STATIC_PAGE_SLUGS, publicPathForStaticPage } from "@/lib/cms/slugify";

export interface UpdateStaticPageState {
  error?: string;
}

export interface CreateStaticPageState {
  error?: string;
}

/**
 * Mirrors createNewsPostAction's exact shape (src/app/ops/cms/news/actions.ts):
 * title required, slug auto-derived unless overridden, catches the DB's
 * unique-constraint conflict rather than pre-checking it.
 */
export async function createStaticPageAction(
  _prevState: CreateStaticPageState,
  formData: FormData,
): Promise<CreateStaticPageState> {
  const ctx = await requireOpsRole(["VOL_MKT"]);
  if (!ctx) return { error: "Not authorized." };

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
  if (RESERVED_STATIC_PAGE_SLUGS.includes(slug)) {
    return { error: `"${slug}" is a reserved page and already exists — choose a different slug.` };
  }

  try {
    await pool.query(
      `INSERT INTO static_pages (slug, title, content, updated_by) VALUES ($1, $2, $3, $4)`,
      [slug, title, content, ctx.id],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "That slug is already in use — try a different one." };
    }
    throw error;
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "CMS_STATIC_PAGE_CREATED",
    metadata: { slug },
  });

  revalidatePath("/ops/cms");
  redirect(`/ops/cms/pages/${slug}`);
}

export async function updateStaticPageAction(
  _prevState: UpdateStaticPageState,
  formData: FormData,
): Promise<UpdateStaticPageState> {
  const ctx = await requireOpsRole(["VOL_MKT"]);
  if (!ctx) return { error: "Not authorized." };

  const slug = String(formData.get("slug") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!title || !content) {
    return { error: "Title and content are both required." };
  }

  const updated = await pool.query(
    `UPDATE static_pages SET title = $1, content = $2, updated_by = $3, updated_at = now() WHERE slug = $4`,
    [title, content, ctx.id, slug],
  );
  if (updated.rowCount === 0) {
    return { error: "That page doesn't exist." };
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "CMS_STATIC_PAGE_UPDATED",
    metadata: { slug },
  });

  revalidatePath(`/ops/cms/pages/${slug}`);
  revalidatePath("/ops/cms");
  revalidatePath(publicPathForStaticPage(slug));
  redirect(`/ops/cms/pages/${slug}`);
}
