import type { PoolClient } from "pg";
import type { RowDataPacket } from "mysql2/promise";
import { legacyQuery } from "./mysqlSource";
import { emptyReport, type MigrationReport } from "./types";
import { legacyAttendeeIdToNewId } from "./users";
import { legacyPassIdToTransactionId } from "./transactions";

interface LegacyOwnedPassRow {
  id: number;
  ownerId: number;
  validFrom: Date;
  validThru: Date;
  passName: string | null;
  passKind: number;
  entitlementNames: string;
}

// Reads directly as base_role='Admin' — no finer-grained equivalent to
// dataview_power/bio_view_power's narrower legacy scope exists in this
// app's role model (docs/MigrationPlan.md §5's volunteer_roles mapping).
const ADMIN_ENTITLEMENTS = new Set([
  "sysadmin_power",
  "registrar_power",
  "dataview_power",
  "bio_view_power",
  "board_status",
]);

// Legacy entitlement -> this app's specific volunteer_role_name. Anything
// carrying only volunteer_status with none of these has no destination —
// this app has no generic "volunteer, unspecified" role, only named
// sub-roles (docs/MigrationPlan.md §5).
const SPECIFIC_ROLE_FOR_ENTITLEMENT: Record<string, string> = {
  board_status: "Board",
  manager_status: "SessionManager",
  model_booker: "ModelBooker",
};

export async function migrateRolesAndMembership(client: PoolClient, cutoverDate: Date): Promise<MigrationReport> {
  const report = emptyReport("volunteer_roles + membership_history");

  const rows = await legacyQuery<(LegacyOwnedPassRow & RowDataPacket)[]>(
    `SELECT op.id, op.ownerId, op.validFrom, op.validThru, op.passName, op.passKind,
            GROUP_CONCAT(e.name) AS entitlementNames
     FROM owned_passes op
     JOIN owned_entitlements oe ON oe.owned_pass_id = op.id
     JOIN entitlements e ON e.id = oe.entitlement_id
     GROUP BY op.id, op.ownerId, op.validFrom, op.validThru, op.passName, op.passKind`,
  );

  const usersToPromoteToAdmin = new Set<string>();
  // users.membership_expires_at is the real, maintained denormalized field
  // this app's MBR-derivation (src/lib/auth/roles.ts) actually reads — not
  // just a byproduct of membership_history existing. Track the latest
  // valid_until per user across every membership_history row inserted
  // below, then write it once per user after the loop (row processing
  // order isn't guaranteed chronological, so take the max directly).
  const latestMembershipExpiry = new Map<string, Date>();

  for (const row of rows) {
    const userId = legacyAttendeeIdToNewId.get(row.ownerId);
    if (!userId) {
      report.skipped += 1;
      report.warnings.push(`owned_passes.id ${row.id}: ownerId ${row.ownerId} has no migrated user — skipped.`);
      continue;
    }

    const entitlements = row.entitlementNames.split(",");

    if (row.passKind === 0) {
      // Resolved with the org: confirmed these 3 rows belong to 3 different
      // real, early (low-numbered) accounts, not one shared test account —
      // read as real if quirky early admin/founder passes, not junk data.
      // Migrated normally through the same entitlement logic as everything
      // else. Informational only, not a pending decision.
      report.warnings.push(
        `owned_passes.id ${row.id} ("${row.passName}"): passKind=0 miscellaneous row, migrated normally per the org's confirmation (docs/MigrationPlan.md §5).`,
      );
    }

    if (entitlements.includes("member_status")) {
      const transactionId = legacyPassIdToTransactionId.get(row.id) ?? null;
      await client.query(
        // created_at uses the linked transaction's real created_at when
        // there is one, else falls back to this membership's own
        // validFrom — never the column's own now() default, which would
        // make every migrated membership row look like a brand new
        // signup/renewal on a --reset staging rehearsal (same reasoning as
        // migrateUsers' created_at fix directly above it).
        `INSERT INTO membership_history (user_id, transaction_id, valid_from, valid_until, created_at)
         VALUES ($1, $2, $3, $4, COALESCE((SELECT created_at FROM transactions WHERE id = $2), $3))`,
        [userId, transactionId, row.validFrom, row.validThru],
      );
      report.migrated += 1;

      const validThru = new Date(row.validThru);
      const current = latestMembershipExpiry.get(userId);
      if (!current || validThru > current) {
        latestMembershipExpiry.set(userId, validThru);
      }
    }

    // Admin promotion and volunteer_roles are CURRENT-state grants, not a
    // historical ledger (unlike membership_history above, which correctly
    // keeps every row regardless of expiry) — an owned_passes row past its
    // own validThru shouldn't confer live access in the new system. Real
    // bug found only by checking real data: 11 of 21 people who'd have
    // been promoted to Admin under the original (date-blind) logic had
    // *only* expired admin-qualifying passes, including a test account
    // ("Manlo Mysterium," attendeeId 2) whose only two qualifying passes
    // were both already expired at import time — one for a single day.
    const isCurrentlyValid = new Date(row.validThru) >= cutoverDate;

    if (entitlements.some((e) => ADMIN_ENTITLEMENTS.has(e))) {
      if (isCurrentlyValid) {
        usersToPromoteToAdmin.add(userId);
      } else {
        report.warnings.push(
          `owned_passes.id ${row.id} ("${row.passName}"): admin-qualifying entitlement, but this pass expired ${row.validThru} — not promoted to Admin from this row (a different, currently-valid pass may still promote the same user).`,
        );
      }
    }

    let assignedSpecificRole = false;
    for (const entitlement of entitlements) {
      const role = SPECIFIC_ROLE_FOR_ENTITLEMENT[entitlement];
      if (role) {
        if (isCurrentlyValid) {
          await client.query(
            `INSERT INTO volunteer_roles (user_id, role) VALUES ($1, $2) ON CONFLICT (user_id, role) DO NOTHING`,
            [userId, role],
          );
          report.migrated += 1;
        } else {
          report.warnings.push(
            `owned_passes.id ${row.id} ("${row.passName}"): would grant ${role}, but this pass expired ${row.validThru} — not assigned.`,
          );
        }
        // Counts as "handled" either way, expired or not — an expired
        // role-granting pass still isn't a "no RBAC destination" case, it's
        // a lapsed one, which is a different (and less concerning) thing.
        assignedSpecificRole = true;
      }
    }

    if (!assignedSpecificRole && entitlements.includes("volunteer_status")) {
      // Resolved with the org, not an open question (docs/MigrationPlan.md
      // §5): most of these categories are volunteer-labor compensation (a
      // free pass for work — cleaning, supply runs, etc.), not an RBAC
      // role, and this app has no generic "volunteer, unspecified" role to
      // assign anyway. Deliberately no volunteer_roles row for any of
      // these — informational only, not a blocker or pending decision.
      report.warnings.push(
        `owned_passes.id ${row.id} ("${row.passName}"): no RBAC role assigned by design — labor-compensation category, not an access role (docs/MigrationPlan.md §5).`,
      );
    }
  }

  for (const userId of usersToPromoteToAdmin) {
    await client.query(`UPDATE users SET base_role = 'Admin' WHERE id = $1`, [userId]);
    report.migrated += 1;
  }

  for (const [userId, expiresAt] of latestMembershipExpiry) {
    await client.query(`UPDATE users SET membership_expires_at = $1 WHERE id = $2`, [expiresAt, userId]);
    report.migrated += 1;
  }

  return report;
}
