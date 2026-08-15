import { Secret, TOTP } from "otpauth";
import { describe, expect, it } from "vitest";
import { buildOtpauthUrl, generateSecret, verifyTotpCode } from "./totp";

function currentCodeFor(secretBase32: string): string {
  return new TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  }).generate();
}

describe("totp", () => {
  it("generates a usable base32 secret", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  });

  it("verifies a code generated from the same secret", () => {
    const secret = generateSecret();
    expect(verifyTotpCode(secret, currentCodeFor(secret))).toBe(true);
  });

  it("rejects a code generated from a different secret", () => {
    const secret = generateSecret();
    const otherSecret = generateSecret();
    expect(verifyTotpCode(secret, currentCodeFor(otherSecret))).toBe(false);
  });

  it("rejects an obviously wrong code", () => {
    const secret = generateSecret();
    expect(verifyTotpCode(secret, "000000")).toBe(false);
  });

  it("builds an otpauth:// URL containing the username and issuer", () => {
    const secret = generateSecret();
    const url = buildOtpauthUrl("someuser", secret);
    expect(url).toContain("otpauth://totp/");
    expect(url).toContain("someuser");
    expect(url).toContain(encodeURIComponent("Life Drawing Society"));
  });
});
