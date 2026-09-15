import { afterEach, describe, expect, it } from "vitest";
import { getLaunchMode, isStaticOnlyLaunch, LEGACY_BOOKING_URL, staticOnlyRedirectFor } from "./launchMode";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("getLaunchMode / isStaticOnlyLaunch", () => {
  it("defaults to full when LAUNCH_MODE is unset", () => {
    delete process.env.LAUNCH_MODE;
    expect(getLaunchMode()).toBe("full");
    expect(isStaticOnlyLaunch()).toBe(false);
  });

  it("is full for any unrecognized value", () => {
    process.env.LAUNCH_MODE = "bogus";
    expect(getLaunchMode()).toBe("full");
  });

  it("is static_only only for the exact string static_only", () => {
    process.env.LAUNCH_MODE = "static_only";
    expect(getLaunchMode()).toBe("static_only");
    expect(isStaticOnlyLaunch()).toBe(true);
  });
});

describe("staticOnlyRedirectFor — full mode", () => {
  it("never redirects anything, regardless of pathname", () => {
    delete process.env.LAUNCH_MODE;
    for (const pathname of [
      "/app/schedule",
      "/app/wallet",
      "/app/support",
      "/dashboard",
      "/auth/register",
      "/",
      "/about",
      "/pricing",
    ]) {
      expect(staticOnlyRedirectFor(pathname)).toBeNull();
    }
  });
});

describe("staticOnlyRedirectFor — static_only mode", () => {
  function set() {
    process.env.LAUNCH_MODE = "static_only";
  }

  it("routes /app/schedule to the legacy booking site, not the generic /app/* rule", () => {
    set();
    expect(staticOnlyRedirectFor("/app/schedule")).toBe(LEGACY_BOOKING_URL);
  });

  it("routes every other /app/* path to home", () => {
    set();
    expect(staticOnlyRedirectFor("/app/wallet")).toBe("/");
    expect(staticOnlyRedirectFor("/app/support")).toBe("/");
    expect(staticOnlyRedirectFor("/app/anything")).toBe("/");
  });

  it("routes /dashboard to home", () => {
    set();
    expect(staticOnlyRedirectFor("/dashboard")).toBe("/");
  });

  it("routes /auth/register to /auth/login", () => {
    set();
    expect(staticOnlyRedirectFor("/auth/register")).toBe("/auth/login");
  });

  it("never gates staff routes", () => {
    set();
    expect(staticOnlyRedirectFor("/auth/login")).toBeNull();
    expect(staticOnlyRedirectFor("/admin/sessions")).toBeNull();
    expect(staticOnlyRedirectFor("/ops/cms")).toBeNull();
  });

  it("never gates public content routes", () => {
    set();
    for (const pathname of ["/", "/about", "/news", "/news/some-post", "/contact", "/pricing", "/pages/faq"]) {
      expect(staticOnlyRedirectFor(pathname)).toBeNull();
    }
  });
});
