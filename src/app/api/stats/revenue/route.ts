import { NextResponse } from "next/server";
import { requireApiKeyScope } from "@/lib/auth/apiKey";
import { getRevenueTrend } from "@/lib/reporting/revenue";

export async function GET(request: Request): Promise<NextResponse> {
  const check = await requireApiKeyScope(request, "revenue");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  return NextResponse.json(await getRevenueTrend());
}
