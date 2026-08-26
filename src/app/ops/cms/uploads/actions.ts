"use server";

import { revalidatePath } from "next/cache";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { writeAuditLog } from "@/lib/audit/log";
import { pool } from "@/lib/db/pool";
import { uploadFile } from "@/lib/uploads/storage";
import { exceedsMaxDimension, readImageDimensions } from "@/lib/uploads/dimensions";
import { MAX_IMAGE_DIMENSION_PX, MAX_UPLOAD_SIZE_BYTES } from "@/lib/uploads/constants";

export interface UploadFileState {
  error?: string;
  url?: string;
}

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

/**
 * Single upload entry point, called both from the standalone /ops/cms/uploads
 * page (a form submit) and imperatively from NewsPostForm.tsx's inline
 * uploader (a direct async call, not a form submission — Server Actions
 * support both). Returns the URL in state rather than redirecting, since
 * both callers need the URL handed back to fill into a field/display for
 * copying, not a page navigation.
 */
export async function uploadFileAction(
  _prevState: UploadFileState,
  formData: FormData,
): Promise<UploadFileState> {
  const ctx = await requireOpsRole(["VOL_MKT"]);
  if (!ctx) return { error: "Not authorized." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
    return { error: "That file type isn't allowed. Use a JPEG, PNG, WebP, GIF, or PDF." };
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return { error: "That file is too large — the limit is 10 MB." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Read dimensions (image content types only) and reject before ever
  // storing the file, not after — no point keeping a rejected upload around.
  const dimensions = readImageDimensions(buffer, file.type);
  if (exceedsMaxDimension(dimensions, MAX_IMAGE_DIMENSION_PX)) {
    return { error: `That image is too large — nothing over ${MAX_IMAGE_DIMENSION_PX}px on a side.` };
  }

  const { url, key } = await uploadFile(buffer, { contentType: file.type });

  const uploadedFileResult = await pool.query<{ id: string }>(
    `INSERT INTO uploaded_files (key, url, content_type, size_bytes, original_filename, width, height, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [key, url, file.type, file.size, file.name, dimensions?.width ?? null, dimensions?.height ?? null, ctx.id],
  );

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "CMS_FILE_UPLOADED",
    metadata: {
      key,
      url,
      contentType: file.type,
      sizeBytes: file.size,
      originalFilename: file.name,
      uploadedFileId: uploadedFileResult.rows[0].id,
    },
  });

  // Harmless for the other two callers (NewsPostForm's imperative upload,
  // the picker's own listUploadedFiles fetch) — this only marks the media
  // library page's cached data stale so it picks up the new file next time
  // it's rendered, whether or not that caller ever navigates there.
  revalidatePath("/ops/cms/media");

  return { url };
}
