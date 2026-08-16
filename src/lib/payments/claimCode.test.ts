import { describe, expect, it } from "vitest";
import { generateClaimCode, hashClaimCode } from "./claimCode";

describe("generateClaimCode", () => {
  it("produces a URL-safe, non-trivial-length code", () => {
    const code = generateClaimCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeGreaterThan(20);
  });

  it("never repeats across calls", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateClaimCode()));
    expect(codes.size).toBe(50);
  });
});

describe("hashClaimCode", () => {
  it("is deterministic for the same input", () => {
    const code = generateClaimCode();
    expect(hashClaimCode(code)).toBe(hashClaimCode(code));
  });

  it("produces different hashes for different codes", () => {
    expect(hashClaimCode(generateClaimCode())).not.toBe(hashClaimCode(generateClaimCode()));
  });

  it("never returns the raw code itself", () => {
    const code = generateClaimCode();
    expect(hashClaimCode(code)).not.toBe(code);
  });
});
