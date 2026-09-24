import { NextResponse } from "next/server";
import { requireApiKeyScope } from "@/lib/auth/apiKey";
import { getTicketCirculationStats } from "@/lib/reporting/ticketCirculation";

export async function GET(request: Request): Promise<NextResponse> {
  const check = await requireApiKeyScope(request, "ticket_circulation");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  return NextResponse.json(await getTicketCirculationStats());
}
