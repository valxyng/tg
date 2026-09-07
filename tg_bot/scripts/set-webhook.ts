import "dotenv/config";
const url = process.env.WEBHOOK_URL?.replace(/\/$/, ""), token = process.env.TELEGRAM_BOT_TOKEN, secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!url || !token || !secret) throw new Error("WEBHOOK_URL, TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET are required");
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: `${url}/api/telegram/webhook`, secret_token: secret, allowed_updates: ["message", "callback_query"] }) });
const result = await response.json() as { ok: boolean; description?: string };
if (!result.ok) throw new Error(result.description || "Telegram rejected webhook");
console.log(`Webhook installed: ${url}/api/telegram/webhook`);
