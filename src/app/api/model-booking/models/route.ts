import { NextResponse } from "next/server";
import { jsonError, parseModelInput, requireModelBookingKey } from "@/lib/models/api";
import { createModel, listModels, type ModelInput } from "@/lib/models/roster";

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireModelBookingKey(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json(await listModels());
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireModelBookingKey(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Body must be JSON.");
  }
  const parsed = parseModelInput(body, "create");
  if (!parsed.ok) return jsonError(400, parsed.error);

  // "create" mode guarantees name is present.
  const result = await createModel(parsed.input as ModelInput & { name: string }, auth.actor);
  if (!result.ok) return jsonError(409, "Another model already has that legacyId.");
  return NextResponse.json(result.model, { status: 201 });
}
