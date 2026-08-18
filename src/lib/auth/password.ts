import { hash, verify } from "@node-rs/argon2";
import { verify as verifyBcrypt } from "@node-rs/bcrypt";

// docs/SecurityDocument.md §2: argon2id, current OWASP recommendation.
export function hashPassword(plainPassword: string): Promise<string> {
  return hash(plainPassword);
}

export function verifyPassword(passwordHash: string, plainPassword: string): Promise<boolean> {
  return verify(passwordHash, plainPassword);
}

// Migrated legacy accounts (docs/MigrationPlan.md §2/§7) carry a bcrypt hash
// ($2y$, confirmed against the legacy dump) until their first successful
// post-cutover login transparently re-hashes them to argon2id.
const BCRYPT_HASH_RE = /^\$2[aby]\$/;

export function isLegacyBcryptHash(passwordHash: string): boolean {
  return BCRYPT_HASH_RE.test(passwordHash);
}

export function verifyLegacyBcryptPassword(
  passwordHash: string,
  plainPassword: string,
): Promise<boolean> {
  return verifyBcrypt(plainPassword, passwordHash);
}
