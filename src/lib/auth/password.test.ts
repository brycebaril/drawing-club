import { describe, expect, it } from "vitest";
import { hash as hashBcrypt } from "@node-rs/bcrypt";
import {
  hashPassword,
  isLegacyBcryptHash,
  verifyLegacyBcryptPassword,
  verifyPassword,
} from "./password";

describe("password", () => {
  it("recognizes bcrypt hash formats ($2a$/$2b$/$2y$)", () => {
    expect(isLegacyBcryptHash("$2y$10$abcdefghijklmnopqrstuv")).toBe(true);
    expect(isLegacyBcryptHash("$2a$10$abcdefghijklmnopqrstuv")).toBe(true);
    expect(isLegacyBcryptHash("$2b$10$abcdefghijklmnopqrstuv")).toBe(true);
  });

  it("does not mistake an argon2id hash for bcrypt", async () => {
    const argon2Hash = await hashPassword("a-real-password");
    expect(isLegacyBcryptHash(argon2Hash)).toBe(false);
  });

  it("verifies a real bcrypt hash (docs/MigrationPlan.md §7's migrated-account path)", async () => {
    const bcryptHash = await hashBcrypt("legacy-password-123");
    expect(await verifyLegacyBcryptPassword(bcryptHash, "legacy-password-123")).toBe(true);
    expect(await verifyLegacyBcryptPassword(bcryptHash, "wrong-password")).toBe(false);
  });

  it("hashPassword/verifyPassword still round-trip via argon2id", async () => {
    const argon2Hash = await hashPassword("another-password");
    expect(await verifyPassword(argon2Hash, "another-password")).toBe(true);
    expect(await verifyPassword(argon2Hash, "wrong-password")).toBe(false);
  });
});
