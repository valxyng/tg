let installed = false;

/** Closes pooled database connections when Railway terminates the Node process. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || installed) return;

  installed = true;

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}; closing database connections`);

    try {
      const { prisma } = await import("@/lib/db");
      await prisma.$disconnect();
    } catch (error) {
      console.error(
        "Database shutdown error",
        error instanceof Error ? error.message : "unknown error"
      );
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  console.log("Telegram webhook application started; health endpoint ready");
}
