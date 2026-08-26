"use server";

import { revalidatePath } from "next/cache";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { pool } from "@/lib/db/pool";
import { writeAuditLog } from "@/lib/audit/log";

export interface UploadedFileRow {
  id: string;
  key: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  originalFilename: string | null;
  width: number | null;
  height: number | null;
  uploadedByUsername: string;
  createdAt: string;
}

/**
 * Called both from the /ops/cms/media Server Component page and directly
 * from MediaPickerModal.tsx as client RPC — same "use server" function
 * reused both ways, matching admin/sessions/[id]/actions.ts's
 * getSessionDetail precedent. Returns [] rather than null for an
 * unauthorized caller, since the picker/page callers both just render an
 * empty list rather than needing to distinguish "no files" from "not
 * allowed" (route-level access is already gated by requireOpsRole on the
 * page itself and by rbac.ts on /ops/cms/*).
 */
export async function listUploadedFiles(): Promise<UploadedFileRow[]> {
  const ctx = await requireOpsRole(["VOL_MKT"]);
  if (!ctx) return [];

  const result = await pool.query<{
    id: string;
    key: string;
    url: string;
    content_type: string;
    size_bytes: number;
    original_filename: string | null;
    width: number | null;
    height: number | null;
    uploaded_by_username: string;
    created_at: Date;
  }>(
    `SELECT f.id, f.key, f.url, f.content_type, f.size_bytes, f.original_filename, f.width, f.height,
            u.username AS uploaded_by_username, f.created_at
     FROM uploaded_files f
     JOIN users u ON u.id = f.uploaded_by
     ORDER BY f.created_at DESC`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    key: row.key,
    url: row.url,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    originalFilename: row.original_filename,
    width: row.width,
    height: row.height,
    uploadedByUsername: row.uploaded_by_username,
    createdAt: row.created_at.toISOString(),
  }));
}

export interface DeleteUploadedFileState {
  error?: string;
}

/**
 * Removes the library *record* only — never the underlying S3/disk object.
 * This app doesn't scan CMS content for references to a URL, so deleting
 * the stored file itself could silently break an already-saved page that
 * still references it; leaving an orphaned file in storage is the safer
 * failure mode. The file simply stops being discoverable/reusable here.
 */
export async function deleteUploadedFileAction(
  _prevState: DeleteUploadedFileState,
  formData: FormData,
): Promise<DeleteUploadedFileState> {
  const ctx = await requireOpsRole(["VOL_MKT"]);
  if (!ctx) return { error: "Not authorized." };

  const fileId = String(formData.get("fileId") ?? "");
  const deleted = await pool.query<{ key: string; url: string }>(
    `DELETE FROM uploaded_files WHERE id = $1 RETURNING key, url`,
    [fileId],
  );
  if (deleted.rowCount === 0) {
    return { error: "That file record doesn't exist." };
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "CMS_FILE_DELETED",
    metadata: { fileId, key: deleted.rows[0].key, url: deleted.rows[0].url },
  });

  revalidatePath("/ops/cms/media");
  return {};
}
