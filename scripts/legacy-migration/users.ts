import type { PoolClient } from "pg";
import type { RowDataPacket } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { legacyQuery } from "./mysqlSource";
import { emptyReport, type MigrationReport } from "./types";
import { hashPassword } from "../../src/lib/auth/password";

interface LegacyAttendeeRow {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  PasswordHash: string | null;
}

interface SuspendedRow {
  suspendedAttendeeID: number;
}

/** legacy session_attendees.id -> migrated users.id, needed by every other
 * migration step that references an attendee (memberships, transactions,
 * passes, sessions, attendance history). */
export const legacyAttendeeIdToNewId = new Map<number, string>();

// Legacy's own 1-character non-hash placeholder for a disabled account
// (docs/LegacyDataAnalysis.md, confirmed against the dump: 2 rows, length 1).
function isDisabledLegacyHash(hash: string | null): boolean {
  return hash === null || hash.length < 20;
}

// scripts/seed.ts's dev/test account usernames — reserved so a real
// migrated member's email-derived username can never collide with one.
// Real bug found by actually running the migration then pnpm seed against
// the same database: a legacy member's email happened to derive to
// exactly "admin", and seed.ts's `ON CONFLICT (username) DO UPDATE SET
// password_hash = EXCLUDED.password_hash` silently overwrote that real
// person's migrated password with the shared dev password, leaving
// base_role untouched (AccountHolder) rather than creating the intended
// separate synthetic "admin" test account at all. seed.ts also runs
// against `staging` between migration rehearsals (ArchitectureDocument.md
// §4), so this collision risk isn't just a local-dev nicety.
const RESERVED_USERNAMES = new Set(["admin", "member", "basic", "host", "modelbooker", "controller"]);

function sanitizeUsernameBase(localPart: string): string {
  const cleaned = localPart.toLowerCase().replace(/[^a-z0-9_]/g, "");
  const padded = cleaned.length >= 3 ? cleaned : `${cleaned}usr`.slice(0, 3).padEnd(3, "0");
  return padded.slice(0, 32);
}

function deriveUsername(email: string, taken: Set<string>): string {
  const localPart = email.split("@")[0] ?? "";
  const base = sanitizeUsernameBase(localPart);
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const suffixStr = String(suffix);
    const candidate = `${base.slice(0, 32 - suffixStr.length)}${suffixStr}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

export async function migrateUsers(client: PoolClient): Promise<MigrationReport> {
  const report = emptyReport("users");

  const [attendees, suspended, existingUsernames] = await Promise.all([
    legacyQuery<(LegacyAttendeeRow & RowDataPacket)[]>(
      `SELECT id, firstName, lastName, email, PasswordHash FROM session_attendees`,
    ),
    legacyQuery<(SuspendedRow & RowDataPacket)[]>(`SELECT suspendedAttendeeID FROM suspended_attendee_accounts`),
    client.query<{ username: string }>(`SELECT username FROM users`),
  ]);

  const suspendedIds = new Set(suspended.map((row) => row.suspendedAttendeeID));
  const takenUsernames = new Set([
    ...existingUsernames.rows.map((row) => row.username.toLowerCase()),
    ...RESERVED_USERNAMES,
  ]);

  for (const row of attendees) {
    const displayName = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
    const username = deriveUsername(row.email, takenUsernames);
    const status = suspendedIds.has(row.id) ? "Suspended" : "Active";

    let passwordHash: string;
    if (isDisabledLegacyHash(row.PasswordHash)) {
      // Legacy's own "disabled, can't log in" state (docs/LegacyDataAnalysis.md
      // §7) — assign a random, unguessable argon2id hash so login stays
      // impossible. No account-recovery/password-reset flow exists in this
      // app yet to properly force a real reset, so this is flagged for an
      // admin to handle manually post-migration (see the warning below).
      passwordHash = await hashPassword(randomUUID());
      report.warnings.push(
        `session_attendees.id ${row.id} had no usable legacy password hash — migrated with a random unusable password; needs admin attention (no password-reset flow exists in this app yet).`,
      );
    } else {
      // Carried over as-is (confirmed bcrypt format) — verified/re-hashed to
      // argon2id transparently on the account's first post-cutover login
      // (docs/MigrationPlan.md §7, src/auth.ts's authorize()).
      passwordHash = row.PasswordHash as string;
    }

    const result = await client.query<{ id: string }>(
      `INSERT INTO users (legacy_id, username, display_name, email, password_hash, base_role, status)
       VALUES ($1, $2, $3, $4, $5, 'AccountHolder', $6)
       RETURNING id`,
      [String(row.id), username, displayName, row.email, passwordHash, status],
    );
    legacyAttendeeIdToNewId.set(row.id, result.rows[0].id);
    report.migrated += 1;
  }

  return report;
}
