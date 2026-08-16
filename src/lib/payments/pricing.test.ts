import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/pool";
import { resolvePrice } from "./pricing";

// Depends on the default-system-settings migration having been applied.

afterAll(() => pool.end());

describe("resolvePrice", () => {
  it("resolves the standard single-pass price for a non-member", async () => {
    const result = await resolvePrice("SinglePass", false);
    expect(result).toEqual({ totalPrice: 20, passCount: 1, effectivePricePerPass: 20 });
  });

  it("resolves the discounted single-pass price for a member", async () => {
    const result = await resolvePrice("SinglePass", true);
    expect(result).toEqual({ totalPrice: 17, passCount: 1, effectivePricePerPass: 17 });
  });

  it("divides a 5-pack price evenly across its passes, standard tier", async () => {
    const result = await resolvePrice("Pack5", false);
    expect(result).toEqual({ totalPrice: 90, passCount: 5, effectivePricePerPass: 18 });
  });

  it("divides a 5-pack price evenly across its passes, member tier", async () => {
    const result = await resolvePrice("Pack5", true);
    expect(result).toEqual({ totalPrice: 75, passCount: 5, effectivePricePerPass: 15 });
  });

  it("divides a 10-pack price evenly across its passes for a member", async () => {
    const result = await resolvePrice("Pack10", true);
    expect(result).toEqual({ totalPrice: 130, passCount: 10, effectivePricePerPass: 13 });
  });

  it("rejects a 10-pack purchase for a non-member — no standard-tier price exists", async () => {
    await expect(resolvePrice("Pack10", false)).rejects.toThrow(/only available to active members/);
  });

  it("resolves the flat membership renewal fee with no pass count", async () => {
    const result = await resolvePrice("MembershipRenewal", false);
    expect(result).toEqual({ totalPrice: 60, passCount: 0, effectivePricePerPass: null });
  });

  it("resolves the same membership renewal fee regardless of current membership status", async () => {
    const result = await resolvePrice("MembershipRenewal", true);
    expect(result).toEqual({ totalPrice: 60, passCount: 0, effectivePricePerPass: null });
  });
});
