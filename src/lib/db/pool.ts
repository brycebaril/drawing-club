import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

declare global {
  var _pgPool: Pool | undefined;
  var _pgConnectionString: string | undefined;
  var _pgCredentialCache: { connectionString: string; fetchedAt: number } | undefined;
}

/**
 * Just the `.query()` slice — what src/lib/audit/log.ts's writeAuditLog
 * actually needs, since it accepts either this module's `pool` or a real
 * `pg.PoolClient` (a transaction's own client, mid-transaction). A real
 * `PoolClient` has no `.connect()`/`.end()` of its own, so it can't satisfy
 * the fuller `QueryablePool` below — only this narrower shape.
 */
export interface Queryable {
  // Defaulting T to `any`, matching @types/pg's own real Pool/PoolClient
  // overloads exactly (confirmed by reading their declaration) — every
  // existing call site across ~150 files calls `pool.query(sql, params)`
  // with no explicit <T>, relying on that permissive default. Defaulting
  // to QueryResultRow instead (a plausible-looking, still-lint-clean
  // choice) silently breaks assignability at call sites that store
  // `.rows`/`.rows[0]` into a concretely-typed variable (found for real:
  // scripts/seed.ts's upsertModel) — QueryResultRow's index signature
  // doesn't propagate through Promise<T>/array positions the way `any`
  // does automatically.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T extends QueryResultRow = any>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

/**
 * The real, confirmed surface every call site in this app actually uses
 * (query/connect, plus end() in test cleanup) — not `pg`'s own `Pool`
 * class, which has dozens of other members a plain wrapper object can't
 * structurally satisfy.
 */
export interface QueryablePool extends Queryable {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

// 15 minutes: cheap enough to cost nothing against a secret that rotates
// every 7 days, tight enough to bound proactive staleness to a small
// window. The real bound on a live rotation is the 28P01 retry below, not
// this interval — this just avoids re-fetching on every request.
const SECRET_CACHE_MS = 15 * 60 * 1000;

/**
 * Builds the real connection string for this request. When
 * DATABASE_SECRET_ARN is unset (local dev, CI — every environment except
 * staging/production), DATABASE_URL is used exactly as it always has been:
 * a complete connection string, no AWS calls, matching this module's
 * original behavior byte for byte. This is the same "no AWS config
 * present -> plain fallback" shape src/lib/email/sender.ts already
 * established for SES, not a new pattern.
 *
 * When DATABASE_SECRET_ARN *is* set (see StagingEnvironment.md — RDS's
 * managed master-password rotation was silently breaking every deploy
 * whenever it fired, since the old static DATABASE_URL never tracked it),
 * DATABASE_URL is instead a *template* containing literal "{username}"/
 * "{password}" tokens, substituted here from the secret's live values.
 * The secret itself only ever contains {username, password} — never host/
 * port/dbname, confirmed directly against the real secret — so those still
 * come from the template.
 */
async function resolveConnectionString(forceRefresh: boolean): Promise<string> {
  const secretArn = process.env.DATABASE_SECRET_ARN;
  if (!secretArn) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    return url;
  }

  const cached = globalThis._pgCredentialCache;
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < SECRET_CACHE_MS) {
    return cached.connectionString;
  }

  const template = process.env.DATABASE_URL;
  if (!template) throw new Error("DATABASE_URL (template) is not set");

  const client = new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const secret = JSON.parse(result.SecretString ?? "{}") as { username: string; password: string };

  const connectionString = substituteCredentials(template, secret.username, secret.password);

  globalThis._pgCredentialCache = { connectionString, fetchedAt: Date.now() };
  return connectionString;
}

/**
 * Pure substitution, split out from resolveConnectionString so it's
 * testable without mocking the AWS SDK. Percent-encodes both values since
 * a generated RDS password routinely contains URI-special characters
 * (confirmed against the real secret during the incident this module
 * fixes) that would otherwise corrupt the connection string.
 */
export function substituteCredentials(template: string, username: string, password: string): string {
  return template.replace("{username}", encodeURIComponent(username)).replace("{password}", encodeURIComponent(password));
}

/**
 * Returns the current real Pool, rebuilding it if the resolved connection
 * string has changed since the last call (a rotation was picked up) — the
 * old pool is drained in the background, not awaited, so a rotation never
 * blocks the request that noticed it.
 *
 * Unconditionally uses globalThis, in every environment — a deliberate
 * change from this module's original dev-only reasoning ("Next.js dev mode
 * reloads modules on every request; reusing a global avoids exhausting
 * connections by creating a new Pool each reload"). That's still true, but
 * now there's a second reason that applies in production too: the
 * credential cache and the current Pool need to survive across requests
 * within the same warm compute instance for rotation-tracking to do
 * anything at all — a per-module-load Pool would re-resolve (and
 * potentially re-fetch) on every single request.
 */
async function getRealPool(forceRefresh: boolean): Promise<Pool> {
  const connectionString = await resolveConnectionString(forceRefresh);
  if (!globalThis._pgPool || connectionString !== globalThis._pgConnectionString) {
    const old = globalThis._pgPool;
    globalThis._pgPool = new Pool({ connectionString });
    globalThis._pgConnectionString = connectionString;
    if (old) old.end().catch(() => {});
  }
  return globalThis._pgPool;
}

// Postgres SQLSTATE for "password authentication failed" — the exact error
// this whole module exists to recover from automatically instead of
// requiring a manual env-var update + redeploy.
const INVALID_PASSWORD_CODE = "28P01";

function isInvalidPasswordError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === INVALID_PASSWORD_CODE;
}

export const pool: QueryablePool = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the Queryable interface's own default, see its comment above.
  async query<T extends QueryResultRow = any>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    const realPool = await getRealPool(false);
    try {
      return await realPool.query<T>(text, params);
    } catch (error) {
      if (!isInvalidPasswordError(error)) throw error;
      const freshPool = await getRealPool(true);
      return await freshPool.query<T>(text, params);
    }
  },
  async connect(): Promise<PoolClient> {
    const realPool = await getRealPool(false);
    try {
      return await realPool.connect();
    } catch (error) {
      if (!isInvalidPasswordError(error)) throw error;
      const freshPool = await getRealPool(true);
      return await freshPool.connect();
    }
  },
  async end(): Promise<void> {
    if (globalThis._pgPool) await globalThis._pgPool.end();
  },
};
