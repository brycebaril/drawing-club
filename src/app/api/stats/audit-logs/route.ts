import { NextResponse } from "next/server";
import { requireApiKeyScope } from "@/lib/auth/apiKey";
import { getRecentAuditLogs } from "@/lib/reporting/auditLogs";

export async function GET(request: Request): Promise<NextResponse> {
  const check = await requireApiKeyScope(request, "audit_logs");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  return NextResponse.json(await getRecentAuditLogs());
}
