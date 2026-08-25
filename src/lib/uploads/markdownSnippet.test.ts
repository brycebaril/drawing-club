import { describe, expect, it } from "vitest";
import { markdownSnippetForUpload } from "./markdownSnippet";

describe("markdownSnippetForUpload", () => {
  it("renders an image tag for an image upload", () => {
    expect(markdownSnippetForUpload({ name: "banner.png", type: "image/png" }, "https://cdn/banner.png")).toBe(
      "![banner.png](https://cdn/banner.png)",
    );
  });

  it("renders a plain link for a non-image upload", () => {
    expect(markdownSnippetForUpload({ name: "bylaws.pdf", type: "application/pdf" }, "https://cdn/bylaws.pdf")).toBe(
      "[bylaws.pdf](https://cdn/bylaws.pdf)",
    );
  });
});
