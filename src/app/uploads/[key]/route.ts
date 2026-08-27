import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { CONTENT_TYPE_FOR_EXTENSION } from "@/lib/uploads/storage";

/**
 * Serves the local-disk upload fallback (src/lib/uploads/storage.ts) —
 * only ever reached when AWS_REGION/S3_BUCKET_NAME are unset, since
 * uploadFile() returns a full S3 URL otherwise. Deliberately a dynamic
 * route reading from disk on every request rather than relying on Next's
 * public/ static serving: confirmed directly against a real production
 * build (`next start`) that a file written to public/uploads *after* the
 * server has already booted 404s permanently for that server's lifetime —
 * `next start` serves public/ off a snapshot taken at boot, not a live
 * filesystem check, and every real upload happens after boot. A route
 * handler always wins routing priority over a stale public/ entry and
 * re-reads the file fresh each time, which is what actually fixes it (not
 * just a workaround for this one quirk — an ephemeral/read-only production
 * filesystem would break the snapshot approach the same way).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
  const { key } = await params;
  // Never trust the URL segment as a path — strip any directory
  // components and require it to look exactly like a generateKey() output
  // (src/lib/uploads/storage.ts: 32 hex chars + a known extension) before
  // touching the filesystem.
  const safeKey = path.basename(key);
  const contentType = CONTENT_TYPE_FOR_EXTENSION[path.extname(safeKey)];
  if (!/^[a-f0-9]{32}\.[a-z0-9]+$/.test(safeKey) || !contentType) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const buffer = await readFile(path.join(process.cwd(), "public", "uploads", safeKey));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        // Keys are random and a given key's file content never changes
        // after it's written, so a long immutable cache is safe.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
