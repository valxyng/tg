import { NextRequest, NextResponse } from "next/server";
import { bot } from "@/bot/index";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!process.env.TELEGRAM_BOT_TOKEN || !secret) return NextResponse.json({ error: "Telegram webhook is not configured" }, { status: 503 });
  if (request.headers.get("x-telegram-bot-api-secret-token") !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { await bot.handleUpdate(await request.json()); return NextResponse.json({ ok: true }); }
  catch (error) { console.error("Telegram webhook update failed", error); return NextResponse.json({ error: "Update failed" }, { status: 500 }); }
}
