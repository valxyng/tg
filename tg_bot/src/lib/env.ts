const requiredAtRuntime = [
  "DATABASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "WEBHOOK_URL",
  "ADMIN_TELEGRAM_ID",
  "CRON_SECRET",
] as const;

/** Fail immediately with a safe, actionable message instead of failing during an update. */
export function assertProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;
  const missing = requiredAtRuntime.filter(name => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Missing required environment variable: ${missing.join(", ")}`);
}
