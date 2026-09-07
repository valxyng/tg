import { NextRequest, NextResponse } from "next/server";
import { runReminders } from "@/jobs/reminders";
export const runtime = "nodejs";
export async function GET(request: NextRequest) { const secret = process.env.CRON_SECRET; if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); try { return NextResponse.json({ status: "ok", ...(await runReminders()) }); } catch (error) { console.error("Reminder cron failed", error); return NextResponse.json({ status: "error" }, { status: 500 }); } }
