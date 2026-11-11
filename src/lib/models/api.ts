import { NextResponse } from "next/server";
import { requireApiKeyScope } from "@/lib/auth/apiKey";
import type { ModelActor, ModelInput } from "./roster";

/**
 * Request-boundary helpers for /api/model-booking/*: auth, path-id and query
 * validation, and body parsing. Everything here runs before any DB call, so a
 * malformed request is a 400/404 with a JSON message, never a Postgres error
 * surfacing as a 500.
 */

export const FEED_DEFAULT_DAYS = 60;
export const FEED_MAX_DAYS = 120;
const MAX_FIELD_LENGTH = 255; // every models column is varchar(255)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function requireModelBookingKey(
  request: Request,
): Promise<{ ok: true; actor: ModelActor } | { ok: false; response: NextResponse }> {
  const check = await requireApiKeyScope(request, "model_booking");
  if (!check.ok) return { ok: false, response: jsonError(check.status, check.error) };
  return { ok: true, actor: { kind: "apiKey", apiKeyId: check.key.id, apiKeyName: check.key.name } };
}

export function parseDays(raw: string | null): { ok: true; days: number } | { ok: false; error: string } {
  if (raw === null || raw === "") return { ok: true, days: FEED_DEFAULT_DAYS };
  const days = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(days >= 1 && days <= FEED_MAX_DAYS)) {
    return { ok: false, error: `days must be a whole number from 1 to ${FEED_MAX_DAYS}.` };
  }
  return { ok: true, days };
}

type FieldResult = { ok: true; value: string | null } | { ok: false; error: string };

/** A nullable text field: string (trimmed, "" → null) or null. legacyId also takes an integer. */
function parseNullableText(field: string, value: unknown, allowInteger = false): FieldResult {
  if (value === null) return { ok: true, value: null };
  if (allowInteger && Number.isSafeInteger(value)) return { ok: true, value: String(value) };
  if (typeof value !== "string") return { ok: false, error: `${field} must be a string or null.` };
  const trimmed = value.trim();
  if (trimmed.length > MAX_FIELD_LENGTH) {
    return { ok: false, error: `${field} must be at most ${MAX_FIELD_LENGTH} characters.` };
  }
  return { ok: true, value: trimmed || null };
}

export function parseModelInput(
  body: unknown,
  mode: "create" | "update",
): { ok: true; input: ModelInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object." };
  }
  const raw = body as Record<string, unknown>;
  const input: ModelInput = {};

  if (raw.name !== undefined) {
    if (typeof raw.name !== "string" || raw.name.trim() === "") {
      return { ok: false, error: "name must be a non-empty string." };
    }
    if (raw.name.trim().length > MAX_FIELD_LENGTH) {
      return { ok: false, error: `name must be at most ${MAX_FIELD_LENGTH} characters.` };
    }
    input.name = raw.name.trim();
  } else if (mode === "create") {
    return { ok: false, error: "name is required." };
  }

  for (const field of ["legacyId", "email", "phone"] as const) {
    if (raw[field] === undefined) continue;
    const parsed = parseNullableText(field, raw[field], field === "legacyId");
    if (!parsed.ok) return parsed;
    input[field] = parsed.value;
  }

  if (raw.retired !== undefined) {
    if (mode === "create") return { ok: false, error: "retired can only be set when updating a model." };
    if (typeof raw.retired !== "boolean") return { ok: false, error: "retired must be true or false." };
    input.retired = raw.retired;
  }

  return { ok: true, input };
}
