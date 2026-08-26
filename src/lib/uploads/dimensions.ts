import { imageSize } from "image-size";

/**
 * Only meaningful for an image content type — a PDF (or anything else the
 * upload allowlist admits) has no width/height, and image-size can throw on
 * a buffer it can't parse (a corrupt file, or one whose declared
 * Content-Type doesn't match its actual bytes), which is a rejection, not a
 * crash.
 */
export function readImageDimensions(
  buffer: Buffer,
  contentType: string,
): { width: number; height: number } | null {
  if (!contentType.startsWith("image/")) return null;
  try {
    const { width, height } = imageSize(buffer);
    return { width, height };
  } catch {
    return null;
  }
}

/** null dimensions (a PDF, or an unreadable buffer) never exceed anything. */
export function exceedsMaxDimension(
  dimensions: { width: number; height: number } | null,
  maxPx: number,
): boolean {
  if (!dimensions) return false;
  return dimensions.width > maxPx || dimensions.height > maxPx;
}
