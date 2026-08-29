import { describe, expect, it } from "vitest";
import { isAllowed } from "./rbac";
import type { Role } from "./roles";

const GUEST = null;
const ACCT: Role[] = ["ACCT"];
const MBR: Role[] = ["ACCT", "MBR"];
const VOL_HOST: Role[] = ["ACCT", "VOL_HOST"];
const VOL_MKT: Role[] = ["ACCT", "VOL_MKT"];
const VOL_MBR: Role[] = ["ACCT", "VOL_MBR"];
const VOL_CTRL: Role[] = ["ACCT", "VOL_CTRL"];
const ADMIN: Role[] = ["ACCT", "ADMIN"];

describe("isAllowed — public pages (SiteOutline.md §4)", () => {
  it.each(["/", "/about", "/news", "/contact"])(
    "%s is reachable by everyone, including guests",
    (path) => {
      expect(isAllowed(path, GUEST)).toBe(true);
      expect(isAllowed(path, ACCT)).toBe(true);
      expect(isAllowed(path, ADMIN)).toBe(true);
    },
  );
});

describe("isAllowed — /auth/login, /auth/register", () => {
  it("guests can reach them", () => {
    expect(isAllowed("/auth/login", GUEST)).toBe(true);
    expect(isAllowed("/auth/register", GUEST)).toBe(true);
  });

  it("authenticated users of any role cannot", () => {
    for (const roles of [ACCT, MBR, VOL_HOST, ADMIN]) {
      expect(isAllowed("/auth/login", roles)).toBe(false);
      expect(isAllowed("/auth/register", roles)).toBe(false);
    }
  });
});

describe("isAllowed — /dashboard, /app/*", () => {
  it("any authenticated role can reach them", () => {
    for (const roles of [ACCT, MBR, VOL_HOST, VOL_MKT, VOL_MBR, VOL_CTRL, ADMIN]) {
      expect(isAllowed("/dashboard", roles)).toBe(true);
      expect(isAllowed("/app/schedule", roles)).toBe(true);
      expect(isAllowed("/app/wallet", roles)).toBe(true);
    }
  });

  it("guests cannot reach most /app/* pages, or /dashboard", () => {
    expect(isAllowed("/dashboard", GUEST)).toBe(false);
    expect(isAllowed("/app/wallet", GUEST)).toBe(false);
  });
});

describe("isAllowed — /app/schedule (unified public + member page)", () => {
  it("is reachable by guests too, unlike the rest of /app/*", () => {
    expect(isAllowed("/app/schedule", GUEST)).toBe(true);
  });
});

describe("isAllowed — /ops/* role-restricted workspaces", () => {
  it("/ops/check-in/:id allows VOL_HOST, VOL_MBR, ADMIN only", () => {
    expect(isAllowed("/ops/check-in/abc-123", VOL_HOST)).toBe(true);
    expect(isAllowed("/ops/check-in/abc-123", VOL_MBR)).toBe(true);
    expect(isAllowed("/ops/check-in/abc-123", ADMIN)).toBe(true);
    expect(isAllowed("/ops/check-in/abc-123", VOL_MKT)).toBe(false);
    expect(isAllowed("/ops/check-in/abc-123", VOL_CTRL)).toBe(false);
    expect(isAllowed("/ops/check-in/abc-123", ACCT)).toBe(false);
    expect(isAllowed("/ops/check-in/abc-123", GUEST)).toBe(false);
  });

  it("/ops/cms allows VOL_MKT, ADMIN only", () => {
    expect(isAllowed("/ops/cms", VOL_MKT)).toBe(true);
    expect(isAllowed("/ops/cms", ADMIN)).toBe(true);
    expect(isAllowed("/ops/cms", VOL_HOST)).toBe(false);
    expect(isAllowed("/ops/cms", VOL_MBR)).toBe(false);
    expect(isAllowed("/ops/cms", VOL_CTRL)).toBe(false);
  });

  it("/ops/model-booking allows VOL_MBR, ADMIN only", () => {
    expect(isAllowed("/ops/model-booking", VOL_MBR)).toBe(true);
    expect(isAllowed("/ops/model-booking", ADMIN)).toBe(true);
    expect(isAllowed("/ops/model-booking", VOL_HOST)).toBe(false);
    expect(isAllowed("/ops/model-booking", VOL_MKT)).toBe(false);
  });

  it("/ops/financials allows VOL_CTRL, ADMIN only", () => {
    expect(isAllowed("/ops/financials", VOL_CTRL)).toBe(true);
    expect(isAllowed("/ops/financials", ADMIN)).toBe(true);
    expect(isAllowed("/ops/financials", VOL_HOST)).toBe(false);
    expect(isAllowed("/ops/financials", VOL_MBR)).toBe(false);
    expect(isAllowed("/ops/financials", VOL_MKT)).toBe(false);
  });
});

describe("isAllowed — /admin/*", () => {
  it("ADMIN only", () => {
    expect(isAllowed("/admin/dashboard", ADMIN)).toBe(true);
    for (const roles of [ACCT, MBR, VOL_HOST, VOL_MKT, VOL_MBR, VOL_CTRL]) {
      expect(isAllowed("/admin/dashboard", roles)).toBe(false);
    }
    expect(isAllowed("/admin/dashboard", GUEST)).toBe(false);
  });
});

describe("isAllowed — /auth/mfa-setup and /auth/verify-email", () => {
  it("mfa-setup requires an authenticated session, not guests", () => {
    expect(isAllowed("/auth/mfa-setup", ACCT)).toBe(true);
    expect(isAllowed("/auth/mfa-setup", GUEST)).toBe(false);
  });

  it("verify-email is reachable regardless of auth state", () => {
    expect(isAllowed("/auth/verify-email", GUEST)).toBe(true);
    expect(isAllowed("/auth/verify-email", ACCT)).toBe(true);
  });
});

describe("isAllowed — unknown routes fail closed", () => {
  it("denies a path with no matching rule", () => {
    expect(isAllowed("/some/未定義/route", ADMIN)).toBe(false);
    expect(isAllowed("/some/未定義/route", GUEST)).toBe(false);
  });
});
