import { NextResponse } from "next/server";
import { isUuid, jsonError, requireModelBookingKey } from "@/lib/models/api";
import { assignModel, unassignModel } from "@/lib/models/assignments";

type Params = { params: Promise<{ id: string; modelId: string }> };

const NOT_FOUND = { "session-not-found": "Session not found.", "model-not-found": "Model not found." } as const;
const CONFLICT = {
  "model-retired": "That model is retired.",
  "session-canceled": "That session is canceled.",
} as const;

/** Assign a model to a session. Idempotent: 200 whether or not it was already assigned. */
export async function PUT(request: Request, { params }: Params): Promise<NextResponse> {
  const auth = await requireModelBookingKey(request);
  if (!auth.ok) return auth.response;

  const { id, modelId } = await params;
  if (!isUuid(id)) return jsonError(404, NOT_FOUND["session-not-found"]);
  if (!isUuid(modelId)) return jsonError(404, NOT_FOUND["model-not-found"]);

  const result = await assignModel(id, modelId, auth.actor);
  if (!result.ok) {
    return result.reason === "session-not-found" || result.reason === "model-not-found"
      ? jsonError(404, NOT_FOUND[result.reason])
      : jsonError(409, CONFLICT[result.reason]);
  }
  return NextResponse.json({ sessionId: id, modelId, created: result.created });
}

/** Remove a model from a session. Idempotent: 204 whether or not it was assigned. */
export async function DELETE(request: Request, { params }: Params): Promise<NextResponse> {
  const auth = await requireModelBookingKey(request);
  if (!auth.ok) return auth.response;

  const { id, modelId } = await params;
  if (!isUuid(id)) return jsonError(404, NOT_FOUND["session-not-found"]);
  if (!isUuid(modelId)) return jsonError(404, NOT_FOUND["model-not-found"]);

  const result = await unassignModel(id, modelId, auth.actor);
  if (!result.ok) return jsonError(404, NOT_FOUND[result.reason]);
  return new NextResponse(null, { status: 204 });
}
