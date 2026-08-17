import { randomBytes, createHash } from "node:crypto";
import { pool } from "@/lib/db/pool";
import type { ReportScope } from "@/lib/reporting/scopes";

/**
 * Design Doc §10 / ArchitectureDocument.md §9: Stats API keys are a
 * separate credential surface from the member-facing Auth.js session flow,
 * hashed at rest — mirrors src/lib/payments/claimCode.ts's exact pattern
 * rather than importing it, since this isn't a payments concern.
 */
export function generateApiKey(): string {
  return randomBytes(24).toString("base64url");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export interface ApiKeyRow {
  id: string;
  name: string;
  scopes: string[];
}

export type ApiKeyCheckResult =
  | { ok: true; key: ApiKeyRow }
  | { ok: false; status: 401 | 403; error: string };

/**
 * `/api/*` is excluded from src/proxy.ts entirely (SecurityDocument.md §3)
 * — every /api/stats/* route calls this itself and turns the result into
 * its own JSON response, same "API routes handle their own auth" shape as
 * /api/webhooks/stripe.
 */
export async function requireApiKeyScope(request: Request, scope: ReportScope): Promise<ApiKeyCheckResult> {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(authHeader);
  if (!match) {
    return { ok: false, status: 401, error: "Missing or malformed Authorization header." };
  }

  const keyHash = hashApiKey(match[1]);
  const result = await pool.query<ApiKeyRow>(
    `SELECT id, name, scopes FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
    [keyHash],
  );
  if (result.rowCount === 0) {
    return { ok: false, status: 401, error: "Invalid or revoked API key." };
  }

  const key = result.rows[0];
  if (!key.scopes.includes(scope)) {
    return { ok: false, status: 403, error: `This key isn't scoped for "${scope}".` };
  }

  await pool.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [key.id]);
  return { ok: true, key };
}
