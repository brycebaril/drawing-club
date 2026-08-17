import { describe, expect, it } from "vitest";
import { slugify } from "./slugify";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Studio Reopens for the Fall Season")).toBe("studio-reopens-for-the-fall-season");
  });

  it("strips punctuation", () => {
    expect(slugify("Gallery Night: What to Expect!")).toBe("gallery-night-what-to-expect");
  });

  it("collapses repeated separators into a single hyphen", () => {
    expect(slugify("Extra   Long   Pose -- Week 1")).toBe("extra-long-pose-week-1");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  -- Membership Renewal Reminder --  ")).toBe("membership-renewal-reminder");
  });

  it("strips diacritics down to their base letters", () => {
    expect(slugify("Café Society Exhibition")).toBe("cafe-society-exhibition");
  });
});
