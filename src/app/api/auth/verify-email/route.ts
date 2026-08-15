import { NextResponse } from "next/server";
import { consumeVerificationToken } from "@/lib/email/verification";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const status = token ? await consumeVerificationToken(token) : "invalid";
  return NextResponse.redirect(new URL(`/auth/verify-email?status=${status}`, request.url));
}
