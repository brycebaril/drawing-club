import { NextResponse } from "next/server";
import { pool } from "@/lib/db/pool";

export async function GET() {
  try {
    await pool.query("SELECT 1");
    return NextResponse.json({ status: "ok", db: "connected" });
  } catch (error) {
    console.error("Health check DB query failed", error);
    return NextResponse.json(
      { status: "error", db: "disconnected" },
      { status: 503 },
    );
  }
}
