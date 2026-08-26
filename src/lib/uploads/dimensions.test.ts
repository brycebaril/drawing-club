import { describe, expect, it } from "vitest";
import { exceedsMaxDimension, readImageDimensions } from "./dimensions";

// A real, minimal 1x1 PNG — enough for image-size to parse a genuine header.
const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("readImageDimensions", () => {
  it("reads width/height from a real image buffer", () => {
    expect(readImageDimensions(ONE_PX_PNG, "image/png")).toEqual({ width: 1, height: 1 });
  });

  it("returns null for a non-image content type", () => {
    expect(readImageDimensions(ONE_PX_PNG, "application/pdf")).toBeNull();
  });

  it("returns null (not a throw) for a corrupt/unparseable buffer claiming to be an image", () => {
    expect(readImageDimensions(Buffer.from("not an image"), "image/png")).toBeNull();
  });
});

describe("exceedsMaxDimension", () => {
  it("is false for null dimensions (a PDF, or an unreadable buffer)", () => {
    expect(exceedsMaxDimension(null, 6000)).toBe(false);
  });

  it("is false when both dimensions are within the cap", () => {
    expect(exceedsMaxDimension({ width: 4000, height: 3000 }, 6000)).toBe(false);
  });

  it("is true when only the width exceeds the cap", () => {
    expect(exceedsMaxDimension({ width: 6001, height: 100 }, 6000)).toBe(true);
  });

  it("is true when only the height exceeds the cap", () => {
    expect(exceedsMaxDimension({ width: 100, height: 6001 }, 6000)).toBe(true);
  });

  it("is false exactly at the cap", () => {
    expect(exceedsMaxDimension({ width: 6000, height: 6000 }, 6000)).toBe(false);
  });
});
