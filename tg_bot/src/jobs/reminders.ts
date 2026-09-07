import "dotenv/config";
import { Bot } from "grammy";
import { prisma } from "../lib/db";
import { settings } from "../lib/settings";

export async function runReminders() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
  const bot = new Bot(token), cfg = await settings(), now = Date.now();
  const rules = [{ kind: "REMINDER_24H" as const, hours: cfg.reminderHours }, { kind: "REMINDER_2H" as const, hours: cfg.secondReminderHours }];
  let sent = 0;
  for (const rule of rules) {
    const from = new Date(now + rule.hours * 3600000 - 5 * 60000), to = new Date(now + rule.hours * 3600000 + 5 * 60000);
    const rows = await prisma.booking.findMany({ where: { status: { in: ["PENDING", "CONFIRMED"] }, startsAt: { gte: from, lt: to }, notifications: { none: { kind: rule.kind } } }, include: { client: true, pet: true, master: true, service: true } });
    for (const booking of rows) try {
      await bot.api.sendMessage(String(booking.client.telegramId), `${cfg.reminderText}\n\n🐶 ${booking.pet.name}\n✂️ ${booking.service.name}\n👩 ${booking.master.name}\n📅 ${booking.startsAt.toLocaleString("ru-RU", { timeZone: cfg.timezone })}\n📍 ${cfg.address}`);
      await prisma.notification.create({ data: { bookingId: booking.id, kind: rule.kind } }); sent++;
    } catch (error) { console.error("Reminder failed", booking.id, error); }
  }
  return { sent };
}
if (require.main === module) runReminders().then(result => { console.log(`Sent ${result.sent} reminders`); process.exit(0); }).catch(error => { console.error(error); process.exit(1); });
