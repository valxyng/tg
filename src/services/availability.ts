import { BookingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { settings } from "@/lib/settings";
import { studioDateTime } from "@/lib/time";

const ACTIVE: BookingStatus[] = ["PENDING", "CONFIRMED"];
export async function availableSlots(masterId: string, serviceId: string, date: string) {
  const [master, service, cfg] = await Promise.all([
    prisma.master.findFirst({ where: { id: masterId, isActive: true, isArchived: false }, include: { schedules: true, breaks: true, exceptions: true } }),
    prisma.service.findFirst({ where: { id: serviceId, isActive: true, isArchived: false } }), settings()
  ]);
  if (!master || !service) return [];
  const dayStart = studioDateTime(date, 0, cfg.timezone);
  const weekday = dayStart.getUTCDay();
  const exception = master.exceptions.find(x => x.date.toISOString().slice(0, 10) === date);
  if (exception?.isDayOff) return [];
  const rule = master.schedules.find(x => x.weekday === weekday && x.isWorking);
  const start = exception?.startMinutes ?? rule?.startMinutes;
  const end = exception?.endMinutes ?? rule?.endMinutes;
  const rangeStart = studioDateTime(date, 0, cfg.timezone), rangeEnd = studioDateTime(date, 24 * 60, cfg.timezone);
  const [bookings, blocks, extraWindows] = await Promise.all([
    prisma.booking.findMany({ where: { masterId, status: { in: ACTIVE }, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } }, select: { startsAt: true, endsAt: true } }),
    prisma.blockedTime.findMany({ where: { masterId, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } }, select: { startsAt: true, endsAt: true } }),
    prisma.availabilityWindow.findMany({ where: { masterId, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } }, select: { startsAt: true, endsAt: true } })
  ]);
  const regularBreaks = master.breaks.filter(x => x.weekday === weekday).map(x => ({ startsAt: studioDateTime(date, x.startMinutes, cfg.timezone), endsAt: studioDateTime(date, x.endMinutes, cfg.timezone) }));
  const now = new Date(), slots: { minutes: number; startsAt: Date }[] = [];
  // A date-specific free window supplements the regular schedule (for overtime or a one-off slot).
  const openRanges = [
    ...(start !== undefined && end !== undefined ? [{ startsAt: studioDateTime(date, start, cfg.timezone), endsAt: studioDateTime(date, end, cfg.timezone) }] : []),
    ...extraWindows
  ];
  for (let minute = 0; minute + service.durationMinutes <= 24 * 60; minute += cfg.bookingIntervalMinutes) {
    const startsAt = studioDateTime(date, minute, cfg.timezone), endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60000);
    if (startsAt <= now) continue;
    if (!openRanges.some(x => x.startsAt <= startsAt && x.endsAt >= endsAt)) continue;
    if (![...bookings, ...blocks, ...regularBreaks].some(x => x.startsAt < endsAt && x.endsAt > startsAt)) slots.push({ minutes: minute, startsAt });
  }
  return slots;
}

export class SlotTakenError extends Error {}
export async function createBooking(input: { clientId: string; petId: string; serviceId: string; masterId: string; startsAt: Date; comment?: string }) {
  return prisma.$transaction(async tx => {
    // Serializes booking attempts for a master without relying on an in-process lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.masterId}))`;
    const [pet, service, master] = await Promise.all([
      tx.pet.findFirst({ where: { id: input.petId, ownerId: input.clientId, isArchived: false } }),
      tx.service.findFirst({ where: { id: input.serviceId, isActive: true, isArchived: false } }),
      tx.master.findFirst({ where: { id: input.masterId, isActive: true, isArchived: false, services: { some: { serviceId: input.serviceId } } } })
    ]);
    if (!pet || !service || !master || input.startsAt <= new Date()) throw new Error("Invalid booking data");
    // Callback data is untrusted: prove that the supplied instant is a generated slot.
    const cfg = await tx.studioSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const date = dateInStudio(input.startsAt, cfg.timezone);
    const eligible = await availableSlots(input.masterId, input.serviceId, date);
    if (!eligible.some(slot => slot.startsAt.getTime() === input.startsAt.getTime())) throw new SlotTakenError();
    const endsAt = new Date(input.startsAt.getTime() + service.durationMinutes * 60000);
    const collision = await tx.booking.findFirst({ where: { masterId: input.masterId, status: { in: ACTIVE }, startsAt: { lt: endsAt }, endsAt: { gt: input.startsAt } } })
      ?? await tx.blockedTime.findFirst({ where: { masterId: input.masterId, startsAt: { lt: endsAt }, endsAt: { gt: input.startsAt } } });
    if (collision) throw new SlotTakenError();
    return tx.booking.create({ data: { ...input, endsAt, priceKopecks: service.priceKopecks }, include: { pet: true, service: true, master: true, client: true } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function dateInStudio(value: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
