import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { resolveDatabaseUrl } from "./resolveDatabaseUrl";

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
 * Wraps resolveDatabaseUrl (src/lib/db/resolveDatabaseUrl.ts) with this
 * module's own cache — the shared function itself does one AWS call (or
 * none, in the local-dev/CI fallback) and returns; caching how often that
 * happens is specific to this long-lived pool process, not to the
 * one-shot migration-step caller of resolveDatabaseUrl.
 */
async function resolveConnectionString(forceRefresh: boolean): Promise<string> {
  const cached = globalThis._pgCredentialCache;
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < SECRET_CACHE_MS) {
    return cached.connectionString;
  }
  const connectionString = await resolveDatabaseUrl();
  globalThis._pgCredentialCache = { connectionString, fetchedAt: Date.now() };
  return connectionString;
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
