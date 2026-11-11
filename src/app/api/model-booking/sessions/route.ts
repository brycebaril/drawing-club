import { NextResponse } from "next/server";
import { jsonError, parseDays, requireModelBookingKey } from "@/lib/models/api";
import { getSessionFeed } from "@/lib/models/sessionFeed";

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireModelBookingKey(request);
  if (!auth.ok) return auth.response;

  const parsed = parseDays(new URL(request.url).searchParams.get("days"));
  if (!parsed.ok) return jsonError(400, parsed.error);
  return NextResponse.json(await getSessionFeed(parsed.days));
}
