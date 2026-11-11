import { NextResponse } from "next/server";
import { isUuid, jsonError, parseModelInput, requireModelBookingKey } from "@/lib/models/api";
import { updateModel } from "@/lib/models/roster";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const auth = await requireModelBookingKey(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Model not found.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Body must be JSON.");
  }
  const parsed = parseModelInput(body, "update");
  if (!parsed.ok) return jsonError(400, parsed.error);

  const result = await updateModel(id, parsed.input, auth.actor);
  if (!result.ok) {
    return result.reason === "not-found"
      ? jsonError(404, "Model not found.")
      : jsonError(409, "Another model already has that legacyId.");
  }
  return NextResponse.json(result.model);
}
