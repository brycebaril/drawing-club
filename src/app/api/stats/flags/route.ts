import { NextResponse } from "next/server";
import { requireApiKeyScope } from "@/lib/auth/apiKey";
import { getOpenFlags } from "@/lib/reporting/flags";

export async function GET(request: Request): Promise<NextResponse> {
  const check = await requireApiKeyScope(request, "flags");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  return NextResponse.json(await getOpenFlags());
}
