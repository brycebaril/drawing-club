import type { PoolClient } from "pg";
import type { RowDataPacket } from "mysql2/promise";
import { legacyQuery } from "./mysqlSource";
import { emptyReport, type MigrationReport } from "./types";

// Placeholder rows used as sentinel values in legacy sessions.modelId — not
// real models. See docs/LegacyDataAnalysis.md finding #5.
const SENTINEL_MODEL_IDS = [74, 100];

interface LegacyModelRow {
  id: number;
  FirstName: string | null;
  LastName: string;
  EMail: string;
  Phone: string | null;
}

/** legacy merdels.id -> migrated models.id, needed by the sessions migration
 * (session_model_mapping) later in the run. */
export const legacyModelIdToNewId = new Map<number, string>();

export async function migrateModels(client: PoolClient): Promise<MigrationReport> {
  const report = emptyReport("models");

  const rows = await legacyQuery<(LegacyModelRow & RowDataPacket)[]>(
    `SELECT id, FirstName, LastName, EMail, Phone FROM merdels WHERE id NOT IN (?, ?)`,
    SENTINEL_MODEL_IDS,
  );

  // Never log the actual email — merdels.id pairs are enough to find and
  // review the real rows directly against the dump, without a PII-bearing
  // value passing through script output/logs.
  const seenEmails = new Map<string, number>();
  for (const row of rows) {
    const email = row.EMail.trim().toLowerCase();
    if (seenEmails.has(email)) {
      // Resolved with the org: confirmed via distinct first/last names on
      // both rows that these are two real, different people who happen to
      // share a contact email — not a duplicate entry. Both migrate
      // normally as-is; this app's models table has no email-uniqueness
      // constraint. Informational only, not a pending decision.
      report.warnings.push(
        `Duplicate model email (merdels.id ${seenEmails.get(email)} and ${row.id}): confirmed two different people sharing an email, both migrated normally (docs/LegacyDataAnalysis.md finding #6).`,
      );
    } else {
      seenEmails.set(email, row.id);
    }

    const name = [row.FirstName, row.LastName].filter(Boolean).join(" ").trim() || row.LastName;
    const contactInfo = [row.EMail, row.Phone].filter(Boolean).join(" / ");

    const result = await client.query<{ id: string }>(
      `INSERT INTO models (legacy_id, name, contact_info) VALUES ($1, $2, $3) RETURNING id`,
      [String(row.id), name, contactInfo],
    );
    legacyModelIdToNewId.set(row.id, result.rows[0].id);
    report.migrated += 1;
  }

  return report;
}
