import { describe, expect, it } from "vitest";
import { roleTone, statusTone, tierTone } from "./Badge";

describe("statusTone", () => {
  it("maps Active to active", () => {
    expect(statusTone("Active")).toBe("active");
  });
  it("maps Suspended to suspended", () => {
    expect(statusTone("Suspended")).toBe("suspended");
  });
  it("maps Banned to banned", () => {
    expect(statusTone("Banned")).toBe("banned");
  });
});

describe("tierTone", () => {
  it("maps a member to member", () => {
    expect(tierTone(true)).toBe("member");
  });
  it("maps a non-member to neutral", () => {
    expect(tierTone(false)).toBe("neutral");
  });
});

describe("roleTone", () => {
  it("maps ADMIN to admin", () => {
    expect(roleTone("ADMIN")).toBe("admin");
  });
  it.each(["VOL_HOST", "VOL_MKT", "VOL_MBR", "VOL_CTRL", "VOL_SUPPORT"])(
    "maps %s to volunteer",
    (role) => {
      expect(roleTone(role)).toBe("volunteer");
    },
  );
});
