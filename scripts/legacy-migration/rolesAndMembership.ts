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

export async function migrateRolesAndMembership(client: PoolClient): Promise<MigrationReport> {
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
      report.warnings.push(
        `owned_passes.id ${row.id} ("${row.passName}"): passKind=0 miscellaneous row — needs manual review (docs/MigrationPlan.md §5).`,
      );
    }

    if (entitlements.includes("member_status")) {
      const transactionId = legacyPassIdToTransactionId.get(row.id) ?? null;
      await client.query(
        `INSERT INTO membership_history (user_id, transaction_id, valid_from, valid_until)
         VALUES ($1, $2, $3, $4)`,
        [userId, transactionId, row.validFrom, row.validThru],
      );
      report.migrated += 1;

      const validThru = new Date(row.validThru);
      const current = latestMembershipExpiry.get(userId);
      if (!current || validThru > current) {
        latestMembershipExpiry.set(userId, validThru);
      }
    }

    if (entitlements.some((e) => ADMIN_ENTITLEMENTS.has(e))) {
      usersToPromoteToAdmin.add(userId);
    }

    let assignedSpecificRole = false;
    for (const entitlement of entitlements) {
      const role = SPECIFIC_ROLE_FOR_ENTITLEMENT[entitlement];
      if (role) {
        await client.query(
          `INSERT INTO volunteer_roles (user_id, role) VALUES ($1, $2) ON CONFLICT (user_id, role) DO NOTHING`,
          [userId, role],
        );
        assignedSpecificRole = true;
        report.migrated += 1;
      }
    }

    if (!assignedSpecificRole && entitlements.includes("volunteer_status")) {
      report.warnings.push(
        `owned_passes.id ${row.id} ("${row.passName}"): only generic volunteer_status, no specific role destination — needs manual review (docs/MigrationPlan.md §5).`,
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
