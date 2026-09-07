import { NextResponse } from "next/server";
export const runtime = "nodejs";

/** Railway liveness check. Database diagnostics remain available at /api/health. */
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
