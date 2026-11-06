import { describe, expect, it } from "vitest";
import { substituteCredentials } from "./resolveDatabaseUrl";

describe("substituteCredentials", () => {
  it("substitutes both tokens into the template", () => {
    const result = substituteCredentials("postgres://{username}:{password}@host:5432/db?sslmode=no-verify", "postgres", "hunter2");
    expect(result).toBe("postgres://postgres:hunter2@host:5432/db?sslmode=no-verify");
  });

  it("percent-encodes URI-special characters in the password", () => {
    // The exact class of real-world RDS-generated password that motivated
    // this — confirmed against the actual incident this module fixes.
    const result = substituteCredentials("postgres://{username}:{password}@host:5432/db", "postgres", "a?b/c@d%e");
    expect(result).toBe("postgres://postgres:a%3Fb%2Fc%40d%25e@host:5432/db");
    expect(result).not.toContain("a?b/c@d%e");
  });

  it("percent-encodes special characters in the username too", () => {
    const result = substituteCredentials("postgres://{username}:{password}@host:5432/db", "a@b", "pw");
    expect(result).toBe("postgres://a%40b:pw@host:5432/db");
  });

  it("leaves the rest of the template untouched", () => {
    const result = substituteCredentials("postgres://{username}:{password}@16.145.214.95:5432/postgres?sslmode=no-verify", "u", "p");
    expect(result).toBe("postgres://u:p@16.145.214.95:5432/postgres?sslmode=no-verify");
  });
});
