import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/pool";
import { getUserAuthContextByUsername } from "./roles";

// Depends on `pnpm seed` having been run against the target database first
// (creates admin/member/basic — see scripts/seed.ts).

afterAll(() => pool.end());

describe("getUserAuthContextByUsername", () => {
  it("resolves an Admin user to ACCT + ADMIN, requiring MFA", async () => {
    const ctx = await getUserAuthContextByUsername("admin");
    expect(ctx).not.toBeNull();
    expect(ctx!.roles.sort()).toEqual(["ACCT", "ADMIN"]);
    expect(ctx!.mfaRequired).toBe(true);
  });

  it("resolves a user with active membership to ACCT + MBR, no MFA required", async () => {
    const ctx = await getUserAuthContextByUsername("member");
    expect(ctx).not.toBeNull();
    expect(ctx!.roles.sort()).toEqual(["ACCT", "MBR"]);
    expect(ctx!.mfaRequired).toBe(false);
  });

  it("resolves a plain Account Holder to just ACCT", async () => {
    const ctx = await getUserAuthContextByUsername("basic");
    expect(ctx).not.toBeNull();
    expect(ctx!.roles).toEqual(["ACCT"]);
    expect(ctx!.mfaRequired).toBe(false);
  });

  it("returns null for a nonexistent username", async () => {
    const ctx = await getUserAuthContextByUsername("does-not-exist");
    expect(ctx).toBeNull();
  });
});
