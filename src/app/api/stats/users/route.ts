import { NextResponse } from "next/server";
import { requireApiKeyScope } from "@/lib/auth/apiKey";
import { getUserStats } from "@/lib/reporting/users";

export async function GET(request: Request): Promise<NextResponse> {
  const check = await requireApiKeyScope(request, "users");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  return NextResponse.json(await getUserStats());
}
