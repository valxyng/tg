import { PrismaClient, UserRole } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  await prisma.studioSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1, address: "Заполните адрес в админ-панели" } });
  const admins = [...new Set([process.env.ADMIN_TELEGRAM_ID, ...(process.env.ADMIN_TELEGRAM_IDS ?? "").split(",")].filter((id): id is string => !!id && /^\d+$/.test(id.trim())).map(id => id.trim()))];
  for (const telegramId of admins) await prisma.user.upsert({ where: { telegramId: BigInt(telegramId) }, update: { role: UserRole.SUPER_ADMIN }, create: { telegramId: BigInt(telegramId), role: UserRole.SUPER_ADMIN, firstName: "Администратор" } });
  if (process.env.SEED_DEMO_DATA !== "true") return;
  const category = await prisma.serviceCategory.upsert({ where: { id: "demo-dogs" }, update: {}, create: { id: "demo-dogs", name: "🐶 Груминг собак", sortOrder: 1 } });
  const service = await prisma.service.upsert({ where: { id: "demo-full" }, update: {}, create: { id: "demo-full", categoryId: category.id, name: "Полный комплекс", description: "Мытьё, сушка, вычёсывание, стрижка и когти.", priceKopecks: 250000, durationMinutes: 120, animalTypes: ["dog"] } });
  await prisma.master.upsert({ where: { id: "demo-master" }, update: {}, create: { id: "demo-master", name: "Елизавета", description: "Грумер", services: { create: { serviceId: service.id } } } });
}
main().finally(() => prisma.$disconnect());
