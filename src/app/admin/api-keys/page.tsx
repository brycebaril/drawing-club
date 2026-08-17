import { pool } from "@/lib/db/pool";
import { AdminNav } from "@/components/AdminNav";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";
import { REPORT_SCOPES } from "@/lib/reporting/scopes";

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
}

export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<{ newKey?: string }>;
}) {
  const { newKey } = await searchParams;

  const result = await pool.query<ApiKeyRow>(
    `SELECT id, name, key_prefix, scopes, created_at, revoked_at, last_used_at
     FROM api_keys ORDER BY created_at DESC`,
  );

  return (
    <main>
      <AdminNav />
      <h1>API keys</h1>
      <p>
        Bearer-token keys for the Stats API (<code>/api/stats/*</code>), scoped per report type. Each key is
        shown in full only once, right after creation.
      </p>

      {newKey && (
        <p role="alert">
          Key created — copy it now, it won&apos;t be shown again: <code>{newKey}</code>
        </p>
      )}

      <h2>Create a key</h2>
      <form action={createApiKeyAction}>
        <label htmlFor="name">Name</label>
        <input id="name" name="name" required />

        <fieldset>
          <legend>Scopes</legend>
          {REPORT_SCOPES.map((scope) => (
            <label key={scope}>
              <input type="checkbox" name={`scope-${scope}`} />
              {scope}
            </label>
          ))}
        </fieldset>

        <button type="submit">Create key</button>
      </form>

      <h2>Existing keys</h2>
      {result.rowCount === 0 ? (
        <p>No keys yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Scopes</th>
              <th>Created</th>
              <th>Last used</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((key) => (
              <tr key={key.id}>
                <td>{key.name}</td>
                <td>
                  <code>{key.key_prefix}…</code>
                </td>
                <td>{key.scopes.join(", ") || "(none)"}</td>
                <td>{new Date(key.created_at).toLocaleDateString()}</td>
                <td>{key.last_used_at ? new Date(key.last_used_at).toLocaleString() : "Never"}</td>
                <td>{key.revoked_at ? "Revoked" : "Active"}</td>
                <td>
                  {!key.revoked_at && (
                    <form action={revokeApiKeyAction}>
                      <input type="hidden" name="id" value={key.id} />
                      <button type="submit">Revoke</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
