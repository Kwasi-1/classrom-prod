import { NextResponse } from "next/server";

/** Liveness check for Render and keep-alive pings. Touches no database, so it never wakes Neon. */
export function GET() {
  return NextResponse.json({ ok: true });
}
