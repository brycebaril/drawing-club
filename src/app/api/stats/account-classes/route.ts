import { NextResponse } from "next/server";
import { requireApiKeyScope } from "@/lib/auth/apiKey";
import { getAccountClassStats } from "@/lib/reporting/accountClasses";

export async function GET(request: Request): Promise<NextResponse> {
  const check = await requireApiKeyScope(request, "account_classes");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  return NextResponse.json(await getAccountClassStats());
}
