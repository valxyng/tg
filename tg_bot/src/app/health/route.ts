import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

/** Railway health check. It verifies both the HTTP process and PostgreSQL connection. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Health check database error", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
