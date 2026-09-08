import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
export const runtime = "nodejs";
const telegramStatus = () => process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET ? "configured" : "not_configured";
export async function GET() { try { await prisma.$queryRaw`SELECT 1`; return NextResponse.json({ status: "ok", database: "connected", telegram: telegramStatus() }); } catch { return NextResponse.json({ status: "degraded", database: "unavailable", telegram: telegramStatus() }, { status: 503 }); } }
