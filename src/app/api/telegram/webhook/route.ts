import { NextRequest, NextResponse } from "next/server";

import { bot } from "@/bot/index";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  console.log("🔥 TELEGRAM WEBHOOK HIT");

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!process.env.TELEGRAM_BOT_TOKEN || !secret) {
    console.error("❌ Telegram webhook is not configured");

    return NextResponse.json(
      { error: "Telegram webhook is not configured" },
      { status: 503 }
    );
  }

  const receivedSecret = request.headers.get(
    "x-telegram-bot-api-secret-token"
  );

  if (receivedSecret !== secret) {
    console.error("❌ Invalid Telegram webhook secret");

    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const update = await request.json();

    console.log("📩 Telegram update received:", update.update_id);

    await bot.handleUpdate(update);

    console.log("✅ Telegram update handled");

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("❌ Telegram webhook update failed:", error);

    return NextResponse.json(
      { error: "Update failed" },
      { status: 500 }
    );
  }
}