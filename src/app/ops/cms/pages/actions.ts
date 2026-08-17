"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { pool } from "@/lib/db/pool";
import { writeAuditLog } from "@/lib/audit/log";

export interface UpdateStaticPageState {
  error?: string;
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
  revalidatePath(`/${slug === "home" ? "" : slug}`);
  redirect(`/ops/cms/pages/${slug}`);
}
