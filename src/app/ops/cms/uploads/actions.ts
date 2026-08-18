"use server";

import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { writeAuditLog } from "@/lib/audit/log";
import { uploadFile } from "@/lib/uploads/storage";
import { MAX_UPLOAD_SIZE_BYTES } from "@/lib/uploads/constants";

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
  const { url, key } = await uploadFile(buffer, { contentType: file.type });

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "CMS_FILE_UPLOADED",
    metadata: { key, url, contentType: file.type, sizeBytes: file.size, originalFilename: file.name },
  });

  return { url };
}
