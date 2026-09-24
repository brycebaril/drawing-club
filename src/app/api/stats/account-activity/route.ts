import { NextResponse } from "next/server";
import { requireApiKeyScope } from "@/lib/auth/apiKey";
import { getAccountActivityStats } from "@/lib/reporting/accountActivity";

export async function GET(request: Request): Promise<NextResponse> {
  const check = await requireApiKeyScope(request, "account_activity");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  return NextResponse.json(await getAccountActivityStats());
}
