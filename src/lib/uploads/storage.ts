import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * Extension is derived from the validated content-type, never from the
 * client-supplied original filename — a filename claiming ".png" with a
 * forged Content-Type (or an .html file renamed to look like an image)
 * would otherwise let the local-disk fallback serve it as whatever its
 * extension implies, since Next's static file server infers Content-Type
 * from the stored key's extension, not any validated metadata. Keys here
 * intentionally match uploadFileAction's ALLOWED_CONTENT_TYPES allowlist —
 * update both together.
 */
const EXTENSION_FOR_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
};

/**
 * The reverse of EXTENSION_FOR_CONTENT_TYPE — used by
 * src/app/uploads/[key]/route.ts to answer "what Content-Type should this
 * stored file be served with" without a DB round trip per request. Update
 * both maps together; they're meant to stay each other's exact inverse.
 */
export const CONTENT_TYPE_FOR_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_FOR_CONTENT_TYPE).map(([contentType, ext]) => [ext, contentType]),
);

/**
 * Mirrors src/lib/email/sender.ts's shape: real S3 whenever AWS_REGION/
 * S3_BUCKET_NAME are set (reusing the AWS_REGION var SES already added —
 * no new region config), a local-disk fallback under public/uploads
 * otherwise. Unlike sendEmail's fallback, this one isn't just a dev
 * convenience — it's what makes the whole upload path genuinely
 * e2e-testable, since CI never sets AWS vars (same as it never sets SES
 * vars) and will exercise this path automatically. Production always has
 * both vars set via Secrets Manager, so the fallback can't mask a real
 * misconfiguration there — identical reasoning to sendEmail.
 *
 * The S3 bucket itself needs a public-read policy provisioned outside this
 * app (same "external AWS review, not a code concern" class of gap as
 * SES's sandbox approval) — this module assumes that's already done.
 */
const s3Client =
  process.env.AWS_REGION && process.env.S3_BUCKET_NAME
    ? new S3Client({ region: process.env.AWS_REGION })
    : null;

export interface UploadedFile {
  url: string;
  key: string;
}

function generateKey(contentType: string): string {
  const ext = EXTENSION_FOR_CONTENT_TYPE[contentType] ?? "";
  return `${randomBytes(16).toString("hex")}${ext}`;
}

/**
 * Never trusts the caller's filename as the storage key or path — the key
 * is a random id plus an extension derived from the (already-validated)
 * content type, not anything client-supplied.
 */
export async function uploadFile(buffer: Buffer, opts: { contentType: string }): Promise<UploadedFile> {
  const key = generateKey(opts.contentType);

  if (s3Client) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: opts.contentType,
      }),
    );
    return {
      url: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
      key,
    };
  }

  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });
  await writeFile(path.join(uploadsDir, key), buffer);
  return { url: `/uploads/${key}`, key };
}
