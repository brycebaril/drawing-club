import { randomBytes, createHash } from "node:crypto";

/**
 * SecurityDocument.md §2 treats a claim code as "effectively a second
 * credential surface" — same hash-at-rest posture as password/verification
 * tokens (src/lib/email/verification.ts), not stored raw in passes.claim_code.
 */
export function generateClaimCode(): string {
  return randomBytes(24).toString("base64url");
}

export function hashClaimCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
