import { hash, verify } from "@node-rs/argon2";

// docs/SecurityDocument.md §2: argon2id, current OWASP recommendation.
export function hashPassword(plainPassword: string): Promise<string> {
  return hash(plainPassword);
}

export function verifyPassword(passwordHash: string, plainPassword: string): Promise<boolean> {
  return verify(passwordHash, plainPassword);
}
