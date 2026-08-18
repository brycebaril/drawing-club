import { randomBytes } from "node:crypto";
import { extname } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

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

function generateKey(originalFilename: string): string {
  const ext = extname(originalFilename).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return `${randomBytes(16).toString("hex")}${ext}`;
}

/**
 * Never trusts the caller's filename as the storage key or path — only
 * its extension, sanitized. Caller (uploadFileAction) is responsible for
 * validating contentType/size before calling this.
 */
export async function uploadFile(
  buffer: Buffer,
  opts: { originalFilename: string; contentType: string },
): Promise<UploadedFile> {
  const key = generateKey(opts.originalFilename);

  if (s3Client && process.env.S3_BUCKET_NAME) {
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
