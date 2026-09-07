import { prisma } from "@/lib/db";
export async function settings() { return prisma.studioSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }); }
export const money = (kopecks: number, currency = "₽") => `${(kopecks / 100).toLocaleString("ru-RU")} ${currency}`;
