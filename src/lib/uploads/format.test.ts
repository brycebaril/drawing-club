import { describe, expect, it } from "vitest";
import { formatFileSize } from "./format";

describe("formatFileSize", () => {
  it("formats bytes under 1 KB as whole bytes", () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  it("formats bytes under 1 MB as KB with one decimal", () => {
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("formats bytes at or over 1 MB as MB with one decimal", () => {
    expect(formatFileSize(1_887_436)).toBe("1.8 MB");
  });
});
