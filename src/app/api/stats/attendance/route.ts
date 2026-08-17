import { NextResponse } from "next/server";
import { requireApiKeyScope } from "@/lib/auth/apiKey";
import { getAttendanceTrend } from "@/lib/reporting/attendance";

export async function GET(request: Request): Promise<NextResponse> {
  const check = await requireApiKeyScope(request, "attendance");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  return NextResponse.json(await getAttendanceTrend());
}
