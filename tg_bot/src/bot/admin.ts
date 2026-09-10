import { Bot, Context, InlineKeyboard, Keyboard } from "grammy";
import { prisma } from "../lib/db";
import { clock, dateInZone, studioDateTime } from "../lib/time";
import { money, settings } from "../lib/settings";
import { availableSlots, createBooking, SlotTakenError } from "../services/availability";

type OwnerCheck = (ctx: Context) => boolean;
type AdminFlow = Record<string, string>;
const ACTIVE = ["PENDING", "CONFIRMED"] as const;
const status = (value: string) => ({ PENDING: "🟡 Ожидает", CONFIRMED: "🟢 Подтверждена", CANCELLED: "🔴 Отменена", COMPLETED: "⚪ Завершена", NO_SHOW: "⚫ Не показалась" }[value] || value);
const today = async () => dateInZone(new Date(), (await settings()).timezone);
const day = (date: string, offset: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const dateLabel = (date: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const back = () => new InlineKeyboard().text("⬅️ Назад", "ad:menu").text("🏠 Главное меню", "ad:home");

async function flow(userId: string) { const value = await prisma.botFlow.findUnique({ where: { userId } }); return value?.state.startsWith("admin:") ? (value.payload as AdminFlow) : null; }
async function setFlow(userId: string, state: string, payload: AdminFlow = {}) { await prisma.botFlow.upsert({ where: { userId }, update: { state: `admin:${state}`, payload }, create: { userId, state: `admin:${state}`, payload } }); }
async function clearFlow(userId: string) { await prisma.botFlow.deleteMany({ where: { userId } }); }
function adminKeyboard() { return new Keyboard().text("📅 Расписание").text("📋 Записи").row().text("➕ Добавить запись").text("👥 Клиенты").row().text("🐾 Питомцы").text("✂️ Услуги").row().text("👩 Мастера").text("💰 Цены").row().text("🚫 Заблокированные окна").text("📊 Статистика").row().text("⚙️ Настройки").row().text("⬅️ В клиентское меню"); }
async function panel(ctx: Context) { await ctx.reply("⚙️ АДМИН-ПАНЕЛЬ\n\nУправляйте студией кнопками ниже.", { reply_markup: adminKeyboard() }); }
async function masterPicker(ctx: Context, prefix: string) { const masters = await prisma.master.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }); const kb = new InlineKeyboard(); masters.forEach(x => kb.text(`👩 ${x.name}`, `${prefix}:${x.id}`).row()); kb.text("⬅️ Назад", "ad:menu"); await ctx.reply("Выберите мастера:", { reply_markup: kb }); }
async function datePicker(ctx: Context, prefix: string) { const base = await today(), kb = new InlineKeyboard(); for (let i = 0; i < 14; i++) { const d = day(base, i); kb.text(dateLabel(d), `${prefix}:${d}`); if (i % 3 === 2) kb.row(); } kb.row().text("⬅️ Назад", "ad:menu"); await ctx.reply("Выберите дату:", { reply_markup: kb }); }

export function registerAdmin(bot: Bot, isOwner: OwnerCheck, clientMenu: (admin?: boolean) => Keyboard) {
  const guard = async (ctx: Context) => { if (!isOwner(ctx)) { if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Недостаточно прав", show_alert: true }); return false; } return true; };
  bot.command("admin", async ctx => { if (await guard(ctx)) await panel(ctx); });
  bot.hears("⚙️ Админ-панель", async ctx => { if (await guard(ctx)) await panel(ctx); });
  bot.hears("⬅️ В клиентское меню", async ctx => { if (await guard(ctx)) await ctx.reply("🐾 Клиентское меню", { reply_markup: clientMenu(true) }); });
  bot.hears("📅 Расписание", async ctx => { if (await guard(ctx)) await masterPicker(ctx, "ad:sch"); });
  bot.hears("📋 Записи", async ctx => { if (!(await guard(ctx))) return; const kb = new InlineKeyboard().text("📅 Сегодня", "ad:bookday:0").text("📅 Завтра", "ad:bookday:1").row().text("📅 На неделю", "ad:bookweek").text("📅 Все", "ad:bookall").row().text("⬅️ Назад", "ad:menu"); await ctx.reply("📋 ЗАПИСИ", { reply_markup: kb }); });
  bot.hears("➕ Добавить запись", async ctx => { if (!(await guard(ctx))) return; const clients = await prisma.user.findMany({ take: 20, orderBy: { createdAt: "desc" } }); const kb = new InlineKeyboard(); clients.forEach(x => kb.text(`${x.firstName || x.username || x.telegramId.toString()}`, `ad:newclient:${x.id}`).row()); kb.text("⬅️ Назад", "ad:menu"); await ctx.reply(clients.length ? "Выберите клиента:" : "Клиентов пока нет.", { reply_markup: kb }); });
  bot.hears("👩 Мастера", async ctx => { if (!(await guard(ctx))) return; const rows = await prisma.master.findMany({ include: { services: { include: { service: true } } }, orderBy: { name: "asc" } }); const kb = new InlineKeyboard().text("➕ Добавить мастера", "ad:masteradd").row(); rows.forEach(x => kb.text(`👩 ${x.name} ${x.isActive ? "" : "⚪"}`, `ad:master:${x.id}`).row()); kb.text("⬅️ Назад", "ad:menu"); await ctx.reply(rows.length ? "👩 Мастера:" : "Мастеров пока нет.", { reply_markup: kb }); });
  bot.hears("✂️ Услуги", async ctx => { if (!(await guard(ctx))) return; const rows = await prisma.service.findMany({ where: { isArchived: false }, include: { category: true }, orderBy: { sortOrder: "asc" } }); const kb = new InlineKeyboard().text("➕ Добавить услугу", "ad:serviceadd").row(); rows.forEach(x => kb.text(`${x.isActive ? "✂️" : "⚪"} ${x.name} — ${money(x.priceKopecks)}`, `ad:service:${x.id}`).row()); kb.text("⬅️ Назад", "ad:menu"); await ctx.reply(rows.length ? "✂️ УСЛУГИ:" : "Услуг пока нет. Добавьте первую.", { reply_markup: kb }); });
  bot.hears("💰 Цены", async ctx => { if (!(await guard(ctx))) return; const rows = await prisma.service.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }); const kb = new InlineKeyboard(); rows.forEach(x => kb.text(`${x.name} — ${money(x.priceKopecks)}`, `ad:price:${x.id}`).row()); kb.text("⬅️ Назад", "ad:menu"); await ctx.reply(rows.length ? "💰 Выберите услугу для изменения цены:" : "Услуг пока нет.", { reply_markup: kb }); });
  bot.hears("👥 Клиенты", async ctx => { if (!(await guard(ctx))) return; const rows = await prisma.user.findMany({ include: { _count: { select: { pets: { where: { isArchived: false } }, bookings: true } } }, orderBy: { createdAt: "desc" }, take: 20 }); const kb = new InlineKeyboard().text("🔎 Найти клиента", "ad:findclient").row(); rows.forEach(x => kb.text(`${x.firstName || x.username || x.telegramId.toString()} · 🐾${x._count.pets}`, `ad:client:${x.id}`).row()); kb.text("⬅️ Назад", "ad:menu"); await ctx.reply("👥 Клиенты (последние 20):", { reply_markup: kb }); });
  bot.hears("🐾 Питомцы", async ctx => { if (!(await guard(ctx))) return; const rows = await prisma.pet.findMany({ where: { isArchived: false }, include: { owner: true }, orderBy: { createdAt: "desc" }, take: 25 }); const kb = new InlineKeyboard(); rows.forEach(x => kb.text(`🐾 ${x.name} · ${x.owner.firstName || "владелец"}`, `ad:pet:${x.id}`).row()); kb.text("⬅️ Назад", "ad:menu"); await ctx.reply(rows.length ? "🐾 Питомцы (последние 25):" : "Питомцев пока нет.", { reply_markup: kb }); });
  bot.hears("🚫 Заблокированные окна", async ctx => { if (await guard(ctx)) await masterPicker(ctx, "ad:blocks"); });
  bot.hears("📊 Статистика", async ctx => { if (!(await guard(ctx))) return; const now = new Date(), week = new Date(now.getTime() - 7 * 86400000), month = new Date(now.getTime() - 30 * 86400000); const [todayCount, weekCount, monthCount, cancelled, completed, noShow, users, pets, popular] = await Promise.all([prisma.booking.count({ where: { startsAt: { gte: new Date(now.setHours(0, 0, 0, 0)) } } }), prisma.booking.count({ where: { startsAt: { gte: week } } }), prisma.booking.count({ where: { startsAt: { gte: month } } }), prisma.booking.count({ where: { status: "CANCELLED" } }), prisma.booking.count({ where: { status: "COMPLETED" } }), prisma.booking.count({ where: { status: "NO_SHOW" } }), prisma.user.count(), prisma.pet.count(), prisma.booking.groupBy({ by: ["serviceId"], _count: { serviceId: true }, orderBy: { _count: { serviceId: "desc" } }, take: 3 })]); const names = await prisma.service.findMany({ where: { id: { in: popular.map(x => x.serviceId) } }, select: { id: true, name: true } }); await ctx.reply(`📊 СТАТИСТИКА\n\nСегодня: ${todayCount}\nЗа неделю: ${weekCount}\nЗа месяц: ${monthCount}\nОтмен: ${cancelled}\nЗавершено: ${completed}\nNo-show: ${noShow}\nКлиентов: ${users}\nПитомцев: ${pets}\n\nПопулярное:\n${popular.map(x => `• ${names.find(n => n.id === x.serviceId)?.name ?? "Услуга"} — ${x._count.serviceId}`).join("\n") || "—"}`, { reply_markup: back() }); });
  bot.hears("⚙️ Настройки", async ctx => { if (!(await guard(ctx))) return; const kb = new InlineKeyboard().text("Название", "ad:set:name").text("Адрес", "ad:set:address").row().text("Телефон", "ad:set:phone").text("Временная зона", "ad:set:timezone").row().text("⬅️ Назад", "ad:menu"); await ctx.reply("⚙️ НАСТРОЙКИ", { reply_markup: kb }); });

  bot.callbackQuery(/^ad:(.+)$/, async ctx => {
    if (!(await guard(ctx))) return;
    await ctx.answerCallbackQuery();
    const parts = ctx.match[1].split(":");
    const [action, a, b] = parts;
    const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(ctx.from!.id) } });
    const f = await flow(user.id);

    if (action === "menu") return void panel(ctx);
    if (action === "home") return void ctx.reply("🐾 Клиентское меню", { reply_markup: clientMenu(true) });
    if (action === "sch") return void datePicker(ctx, `ad:schdate:${a}`);
    if (action === "schdate") { const master = await prisma.master.findUniqueOrThrow({ where: { id: a } }); const cfg = await settings(), start = studioDateTime(b, 0, cfg.timezone), end = studioDateTime(day(b, 1), 0, cfg.timezone), rows = await prisma.booking.findMany({ where: { masterId: a, startsAt: { gte: start, lt: end }, status: { in: ACTIVE } }, include: { pet: true, service: true }, orderBy: { startsAt: "asc" } }); const kb = new InlineKeyboard(); rows.forEach(x => kb.text(`${clock(Math.floor((x.startsAt.getTime() - start.getTime()) / 60000))} ${x.pet.name}`, `ad:booking:${x.id}`).row()); kb.text("⬅️ Назад", "ad:sch:" + a); await ctx.reply(`${master.name}, ${dateLabel(b)}:\n\n${rows.length ? "Записи:" : "Записей нет."}`, { reply_markup: kb }); return; }
    if (action === "schedule") return void masterPicker(ctx, "ad:sch");
    if (action === "addwin" || action === "block") { await setFlow(user.id, action, { masterId: a, date: b }); return void ctx.reply(action === "addwin" ? "Введите время окна в формате 09:00-18:00:" : "Введите период блокировки в формате 09:00-18:00:", { reply_markup: back() }); }
    if (action === "day") { await setFlow(user.id, "day", { masterId: a, date: b }); return void ctx.reply("Введите часы дня `09:00-18:00`, либо `выходной`.", { parse_mode: "Markdown", reply_markup: back() }); }
    if (action === "blocks") { const cfg = await settings(), from = studioDateTime(await today(), 0, cfg.timezone), rows = await prisma.blockedTime.findMany({ where: { masterId: a, endsAt: { gte: from } }, orderBy: { startsAt: "asc" } }); const kb = new InlineKeyboard().text("➕ Добавить блокировку", `ad:blockpick:${a}`).row(); rows.forEach(x => kb.text(`${x.startsAt.toLocaleString("ru-RU", { timeZone: cfg.timezone })}`, `ad:unblock:${x.id}`).row()); kb.text("⬅️ Назад", "ad:menu"); await ctx.reply(rows.length ? "🚫 Заблокированные периоды:" : "Блокировок нет.", { reply_markup: kb }); return; }
    if (action === "blockpick") return void masterPicker(ctx, "ad:blockmaster");
    if (action === "blockmaster") return void datePicker(ctx, `ad:blockdate:${a}`);
    if (action === "blockdate") { await setFlow(user.id, "block", { masterId: a, date: b }); return void ctx.reply("Введите период блокировки в формате 09:00-18:00:", { reply_markup: back() }); }
    if (action === "unblock") { await prisma.blockedTime.delete({ where: { id: a } }); return void ctx.reply("✅ Блокировка снята.", { reply_markup: back() }); }
    if (action === "bookpick") return void datePicker(ctx, "ad:bookdate");
    if (action === "bookday" || action === "bookdate" || action === "bookweek" || action === "bookall") {
      const cfg = await settings();
      let where = {};
      if (action !== "bookall") {
        const startDay = action === "bookday" ? day(await today(), parseInt(a)) : a;
        const endDay = action === "bookday" ? day(startDay, 1) : action === "bookdate" ? day(a, 1) : day(await today(), parseInt(a) + 7);
        where = { startsAt: { gte: studioDateTime(startDay, 0, cfg.timezone), lt: studioDateTime(endDay, 0, cfg.timezone) } };
      }
      const rows = await prisma.booking.findMany({ where: { ...where, status: { in: ACTIVE } }, include: { client: true, pet: true, service: true, master: true }, orderBy: { startsAt: "asc" }, take: 50 });
      const kb = new InlineKeyboard();
      rows.forEach(x => kb.text(`${x.client.firstName || "Клиент"} · ${x.pet.name}`, `ad:booking:${x.id}`).row());
      kb.text("⬅️ Назад", "ad:menu");
      await ctx.reply(rows.length ? `📋 Записи:\n\n${rows.map(x => `🐶 ${x.pet.name}\n👤 ${x.client.firstName || "—"}\n✂️ ${x.service.name}\n👩 ${x.master.name}\n📅 ${x.startsAt.toLocaleString("ru-RU", { timeZone: cfg.timezone })}\n${status(x.status)}`).join("\n\n")}` : "Записей нет.", { reply_markup: kb });
      return;
    }
    if (action === "booking") { const x = await prisma.booking.findUniqueOrThrow({ where: { id: a }, include: { client: true, pet: true, service: true, master: true } }); const kb = new InlineKeyboard().text("✅ Подтвердить", `ad:status:${x.id}:CONFIRMED`).text("❌ Отменить", `ad:status:${x.id}:CANCELLED`).row().text("⬅️ Назад", "ad:menu"); await ctx.reply(`📋 ЗАПИСЬ\n\n🐶 ${x.pet.name}\n👤 ${x.client.firstName || "Клиент"}\n✂️ ${x.service.name}\n👩 ${x.master.name}\n📅 ${x.startsAt.toLocaleString("ru-RU")}\n${status(x.status)}`, { reply_markup: kb }); return; }
    if (action === "status") { const result = await prisma.booking.updateMany({ where: { id: a, status: { in: [...ACTIVE] } }, data: { status: b as never } }); if (!result.count) return void ctx.reply("Запись уже обработана.", { reply_markup: back() }); const booking = await prisma.booking.findUniqueOrThrow({ where: { id: a }, include: { client: true, service: true } }); const msg = b === "CONFIRMED" ? `✅ Запись подтверждена\n\n${booking.service.name}` : `❌ Запись отменена`; const cfg = await settings(); await bot.api.sendMessage(String(booking.client.telegramId), msg + `\n\n${booking.startsAt.toLocaleString("ru-RU", { timeZone: cfg.timezone })}`).catch(() => null); return void ctx.reply(`✅ Статус изменён на ${b}.`, { reply_markup: back() }); }
    if (action === "newclient") { const pets = await prisma.pet.findMany({ where: { ownerId: a, isArchived: false } }); const kb = new InlineKeyboard(); pets.forEach(x => kb.text(x.name, `ad:newpet:${x.id}`).row()); kb.text("⬅️ Назад", "ad:menu"); await ctx.reply(pets.length ? "Выберите питомца:" : "У этого клиента нет питомцев.", { reply_markup: kb }); return; }
    if (action === "newpet") { const pet = await prisma.pet.findUniqueOrThrow({ where: { id: a } }); const services = await prisma.service.findMany({ where: { isActive: true, isArchived: false, animalTypes: { has: pet.species } }, orderBy: { sortOrder: "asc" } }); const kb = new InlineKeyboard(); services.forEach(x => kb.text(x.name, `ad:newservice:${pet.id}:${x.id}`).row()); kb.text("⬅️ Назад", "ad:menu"); await ctx.reply(services.length ? "Выберите услугу:" : "Нет подходящих услуг.", { reply_markup: kb }); return; }
    if (action === "newservice") { const masters = await prisma.master.findMany({ where: { isActive: true, isArchived: false, services: { some: { serviceId: b } } } }); const kb = new InlineKeyboard(); masters.forEach(x => kb.text(`👩 ${x.name}`, `ad:newmaster:${a}:${b}:${x.id}`).row()); kb.text("⬅️ Назад", "ad:menu"); await ctx.reply(masters.length ? "Выберите мастера:" : "Нет свободных мастеров.", { reply_markup: kb }); return; }
    if (action === "newmaster") { await setFlow(user.id, "newdate", { petId: a, serviceId: b, masterId: parts[3] }); return void datePicker(ctx, "ad:newdatepick"); }
    if (action === "newdatepick") { const f = await flow(user.id); if (!f) return; const slots = await availableSlots(f.masterId, f.serviceId, a), kb = new InlineKeyboard(); slots.forEach((x, i) => { kb.text(clock(x.minutes), `ad:newtime:${x.minutes}`); if (i % 4 === 3) kb.row(); }); kb.row().text("⬅️ Назад", "ad:menu"); await ctx.reply(slots.length ? "Выберите время:" : "Нет свободного времени.", { reply_markup: kb }); return; }
    if (action === "newtime") { const f = await flow(user.id); if (!f) return; try { const cfg = await settings(); const pet = await prisma.pet.findUniqueOrThrow({ where: { id: f.petId } }); const booking = await createBooking({ clientId: pet.ownerId, petId: f.petId, serviceId: f.serviceId, masterId: f.masterId, startsAt: studioDateTime(f.date, Number(a), cfg.timezone) }); await clearFlow(user.id); await ctx.reply(`✅ Запись создана\n\n🐶 ${booking.pet.name}`, { reply_markup: back() }); } catch (e) { await ctx.reply("Ошибка создания записи.", { reply_markup: back() }); } return; }
    if (action === "masteradd") { await setFlow(user.id, "masteradd"); return void ctx.reply("Введите имя мастера:", { reply_markup: back() }); }
    if (action === "master") { const x = await prisma.master.findUniqueOrThrow({ where: { id: a }, include: { services: { include: { service: true } } } }); const kb = new InlineKeyboard().text(x.isActive ? "Выключить" : "Включить", `ad:mastertoggle:${a}`).text("🗑 Архивировать", `ad:masterarchive:${a}`).row().text("⬅️ Назад", "ad:menu"); await ctx.reply(`👩 ${x.name}\n\nУслуги: ${x.services.map(s => s.service.name).join(", ") || "—"}`, { reply_markup: kb }); return; }
    if (action === "mastertoggle") { const x = await prisma.master.findUniqueOrThrow({ where: { id: a } }); await prisma.master.update({ where: { id: a }, data: { isActive: !x.isActive } }); return void ctx.reply(`✅ Мастер ${x.isActive ? "выключен" : "включен"}.`, { reply_markup: back() }); }
    if (action === "masterarchive") { await prisma.master.update({ where: { id: a }, data: { isArchived: true, isActive: false } }); return void ctx.reply("✅ Мастер архивирован.", { reply_markup: back() }); }
    
    // Service management
    if (action === "services") {
      const rows = await prisma.service.findMany({ where: { isArchived: false }, include: { category: true }, orderBy: { sortOrder: "asc" } });
      const kb = new InlineKeyboard().text("➕ Добавить услугу", "ad:serviceadd").row();
      rows.forEach(x => kb.text(`${x.isActive ? "✂️" : "⚪"} ${x.name} — ${money(x.priceKopecks)}`, `ad:service:${x.id}`).row());
      kb.text("⬅️ Назад", "ad:menu");
      return void ctx.reply(rows.length ? "✂️ УСЛУГИ:" : "Услуг пока нет.", { reply_markup: kb });
    }
    if (action === "serviceadd") {
      const cats = await prisma.serviceCategory.findMany({ where: { isArchived: false } });
      if (!cats.length) {
        await setFlow(user.id, "categoryadd");
        return void ctx.reply("Снимите категорию услуг, например: Груминг", { reply_markup: back() });
      }
      const kb = new InlineKeyboard();
      cats.forEach(c => kb.text(c.name, `ad:servicecat:${c.id}`).row());
      kb.text("➕ Создать категорию", "ad:categoryadd").row().text("⬅️ Назад", "ad:menu");
      return void ctx.reply("Выберите категорию услуги:", { reply_markup: kb });
    }
    if (action === "categoryadd") {
      await setFlow(user.id, "categoryadd");
      return void ctx.reply("Введите название новой категории:", { reply_markup: back() });
    }
    if (action === "servicecat") {
      await setFlow(user.id, "servicename", { categoryId: a });
      return void ctx.reply("Введите название услуги:", { reply_markup: back() });
    }
    if (action === "service") {
      const x = await prisma.service.findUniqueOrThrow({ where: { id: a } });
      const kb = new InlineKeyboard()
        .text("✏️ Название", `ad:serviceedit:${a}:name`)
        .text("📝 Описание", `ad:serviceedit:${a}:description`).row()
        .text("💰 Цена", `ad:serviceedit:${a}:priceKopecks`)
        .text("⏱ Длительность", `ad:serviceedit:${a}:durationMinutes`).row()
        .text(x.isActive ? "🔴 Выключить" : "🟢 Включить", `ad:servicetoggle:${a}`)
        .text("🗑 Архивировать", `ad:servicearchive:${a}`).row()
        .text("⬅️ Назад", "ad:services");
      await ctx.reply(`✂️ ${x.name}\n\n📝 ${x.description || "—"}\n💰 ${money(x.priceKopecks)}\n⏱ ${x.durationMinutes} мин.\n${x.isActive ? "🟢 Активна" : "🔴 Неактивна"}`, { reply_markup: kb });
      return;
    }
    if (action === "serviceedit") {
      await setFlow(user.id, "serviceedit", { serviceId: a, field: b });
      const prompts = {
        name: "Введите новое название услуги:",
        description: "Введите описание услуги (или отправьте —):",
        priceKopecks: "Введите новую цену в рублях (например: 4000):",
        durationMinutes: "Введите длительность в минутах (м��нимум 15):"
      };
      return void ctx.reply(prompts[b as keyof typeof prompts] || "Введите значение:", { reply_markup: back() });
    }
    if (action === "servicetoggle") {
      const x = await prisma.service.findUniqueOrThrow({ where: { id: a } });
      await prisma.service.update({ where: { id: a }, data: { isActive: !x.isActive } });
      return void ctx.reply(`✅ Услуга ${x.isActive ? "выключена" : "включена"}.`, { reply_markup: back() });
    }
    if (action === "servicearchive") {
      await prisma.service.update({ where: { id: a }, data: { isArchived: true, isActive: false } });
      return void ctx.reply("✅ Услуга архивирована.", { reply_markup: back() });
    }
    if (action === "price") { await setFlow(user.id, "price", { serviceId: a }); return void ctx.reply("Введите новую цену в рублях, например: 4000", { reply_markup: back() }); }

    if (action === "client") {
      const x = await prisma.user.findUniqueOrThrow({
        where: { id: a },
        include: { pets: { where: { isArchived: false } }, _count: { select: { bookings: true } } }
      });
      const kb = new InlineKeyboard()
        .text("🐾 Питомцы", `ad:clientpets:${a}`)
        .text("📋 История", `ad:clienthistory:${a}`).row()
        .text("✉️ Написать", `ad:clientmessage:${a}`)
        .text(x.isBlocked ? "✅ Разблокировать" : "🚫 Заблокировать", `ad:clientblock:${a}`).row()
        .text("⬅️ Назад", "ad:menu");
      await ctx.reply(`👤 ${x.firstName || "Клиент"}\n\nTelegram ID: ${x.telegramId}\nUsername: ${x.username ? `@${x.username}` : "—"}\n📱 Телефон: ${x.phone || "—"}\n\n🐾 Питомцы: ${x.pets.length}\n${x.pets.map(p => `${p.species === "cat" ? "🐱" : "🐶"} ${p.name} — ${p.breed || "порода не указана"}`).join("\n") || "—"}\n\n📅 Записей: ${x._count.bookings}`, { reply_markup: kb });
      return;
    }
    if (action === "clientpets") {
      const pets = await prisma.pet.findMany({ where: { ownerId: a, isArchived: false }, orderBy: { name: "asc" } });
      const kb = new InlineKeyboard();
      pets.forEach(p => kb.text(p.name, `ad:pet:${p.id}`).row());
      kb.text("⬅️ К клиенту", `ad:client:${a}`);
      return void ctx.reply(pets.length ? "🐾 Питомцы клиента:" : "Питомцев нет.", { reply_markup: kb });
    }
    if (action === "clienthistory") {
      const rows = await prisma.booking.findMany({ where: { clientId: a }, include: { pet: true, service: true }, orderBy: { startsAt: "desc" }, take: 30 });
      const kb = new InlineKeyboard().text("⬅️ К клиенту", `ad:client:${a}`);
      return void ctx.reply(rows.length ? `📋 История записей:\n\n${rows.map(x => `${x.startsAt.toLocaleDateString("ru-RU")} — ${x.pet.name} — ${x.service.name} — ${status(x.status)}`).join("\n")}` : "Записей нет.", { reply_markup: kb });
    }
    if (action === "clientmessage") {
      const x = await prisma.user.findUniqueOrThrow({ where: { id: a } });
      return void ctx.reply(`Откройте диалог с клиентом в Telegram: ${x.username ? `@${x.username}` : `Telegram ID ${x.telegramId}`}`, { reply_markup: new InlineKeyboard().text("⬅️ К клиенту", `ad:client:${a}`) });
    }
    if (action === "clientblock") {
      const x = await prisma.user.findUniqueOrThrow({ where: { id: a } });
      await prisma.user.update({ where: { id: a }, data: { isBlocked: !x.isBlocked } });
      return void ctx.reply(x.isBlocked ? "✅ Клиент разблокирован." : "✅ Клиент заблокирован.", { reply_markup: new InlineKeyboard().text("⬅️ К клиенту", `ad:client:${a}`) });
    }
    if (action === "pet") {
      const x = await prisma.pet.findUniqueOrThrow({ where: { id: a }, include: { owner: true, bookings: { include: { service: true }, orderBy: { startsAt: "desc" }, take: 5 } } });
      return void ctx.reply(`🐾 ${x.name}\nВид: ${x.species}\nПорода: ${x.breed || "—"}\nПол: ${x.sex || "—"}\nВладелец: ${x.owner.firstName || "—"}\nЗаметки: ${x.notes || "—"}\n\nИстория:\n${x.bookings.map(y => `• ${y.service.name} · ${status(y.status)}`).join("\n") || "—"}`, { reply_markup: back() });
    }
    if (action === "findclient") { await setFlow(user.id, "findclient"); return void ctx.reply("Введите имя, username или Telegram ID клиента:", { reply_markup: back() }); }
    if (action === "set") { await setFlow(user.id, "setting", { field: a }); return void ctx.reply(`Введите новое значение для «${a}»:`, { reply_markup: back() }); }
  });

  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from!.id) } });
    if (!user) return next();
    const f = await flow(user.id);
    if (!f) return next();
    const state = (await prisma.botFlow.findUniqueOrThrow({ where: { userId: user.id } }))!.state.slice(6);
    const text = ctx.message.text!.trim();

    if (state === "masteradd") { const services = await prisma.service.findMany({ where: { isActive: true, isArchived: false }, select: { id: true } }); await prisma.master.create({ data: { name: text, services: { create: services.map(s => ({ serviceId: s.id })) } } }); await clearFlow(user.id); return void ctx.reply("✅ Мастер добавлен.", { reply_markup: adminKeyboard() }); }
    if (state === "categoryadd") { const x = await prisma.serviceCategory.create({ data: { name: text } }); await setFlow(user.id, "servicename", { categoryId: x.id }); return void ctx.reply("Введите название услуги:", { reply_markup: back() }); }
    if (state === "servicename") { await setFlow(user.id, "servicedescription", { ...f, name: text }); return void ctx.reply("Введите описание услуги или «—», если нет описания:", { reply_markup: back() }); }
    if (state === "servicedescription") { await setFlow(user.id, "serviceprice", { ...f, description: text === "—" ? "" : text }); return void ctx.reply("Введите цену в рублях (например: 4000):", { reply_markup: back() }); }
    if (state === "serviceprice") { const n = Number(text.replace(",", ".")); if (!Number.isFinite(n) || n < 0) return void ctx.reply("Введите корректную цену числом.", { reply_markup: back() }); await setFlow(user.id, "serviceduration", { ...f, price: text }); return void ctx.reply("Введите длительность в минутах (минимум 15):", { reply_markup: back() }); }
    if (state === "serviceduration") { const n = Number(text); if (!Number.isInteger(n) || n < 15) return void ctx.reply("Введите длительность не менее 15 минут.", { reply_markup: back() }); await prisma.service.create({ data: { categoryId: f.categoryId!, name: f.name!, description: f.description, priceKopecks: Math.round(Number(f.price!) * 100), durationMinutes: n, animalTypes: ["dog", "cat"] } }); await clearFlow(user.id); return void ctx.reply("✅ Услуга добавлена для собак и кошек.", { reply_markup: adminKeyboard() }); }
    if (state === "serviceedit") {
      const field = f.field as "name" | "description" | "priceKopecks" | "durationMinutes";
      let updateData: any = {};
      if (field === "name") { if (!text) return void ctx.reply("Название не может быть пустым.", { reply_markup: back() }); updateData = { name: text }; }
      else if (field === "description") { updateData = { description: text === "—" ? "" : text }; }
      else if (field === "priceKopecks") { const n = Number(text.replace(",", ".")); if (!Number.isFinite(n) || n < 0) return void ctx.reply("Введите корректную цену.", { reply_markup: back() }); updateData = { priceKopecks: Math.round(n * 100) }; }
      else if (field === "durationMinutes") { const n = Number(text); if (!Number.isInteger(n) || n < 15) return void ctx.reply("Введите длительность не менее 15 минут.", { reply_markup: back() }); updateData = { durationMinutes: n }; }
      await prisma.service.update({ where: { id: f.serviceId! }, data: updateData });
      await clearFlow(user.id);
      return void ctx.reply("✅ Услуга обновлена.", { reply_markup: adminKeyboard() });
    }
    if (state === "price") { const n = Number(text.replace(",", ".")); if (!Number.isFinite(n) || n < 0) return void ctx.reply("Введите корректную цену."); await prisma.service.update({ where: { id: f.serviceId! }, data: { priceKopecks: Math.round(n * 100) } }); await clearFlow(user.id); return void ctx.reply("✅ Цена обновлена.", { reply_markup: adminKeyboard() }); }
    if (state === "setting") { const fields = ["name", "address", "phone", "timezone", "welcomeText", "bookingSuccessText"]; if (!fields.includes(f.field!)) return next(); await prisma.studioSettings.update({ where: { id: 1 }, data: { [f.field!]: text } }); await clearFlow(user.id); return void ctx.reply("✅ Настройка сохранена.", { reply_markup: adminKeyboard() }); }
    if (state === "findclient") { const digits = text.replace(/\D/g, ""); const telegramMatch = digits.length > 0 && digits.length <= 19 ? [{ telegramId: BigInt(digits) }] : []; const rows = await prisma.user.findMany({ where: { OR: [{ firstName: { contains: text, mode: "insensitive" } }, { username: { contains: text.replace(/^@/, ""), mode: "insensitive" } }, { phone: { contains: text, mode: "insensitive" } }, ...telegramMatch] }, take: 20 }); const kb = new InlineKeyboard(); rows.forEach(x => kb.text(x.firstName || x.username || x.telegramId.toString(), `ad:client:${x.id}`).row()); await clearFlow(user.id); return void ctx.reply(rows.length ? "Результаты:" : "Ничего не найдено.", { reply_markup: kb }); }
    if (state === "day" || state === "addwin" || state === "block") { const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(text); const cfg = await settings(); if (state === "day" && text.toLowerCase() === "выходной") { await prisma.scheduleException.upsert({ where: { masterId_date: { masterId: f.masterId!, date: new Date(`${f.date}T00:00:00.000Z`) } }, update: { isDayOff: true, startMinutes: null, endMinutes: null }, create: { masterId: f.masterId!, date: new Date(`${f.date}T00:00:00.000Z`), isDayOff: true } }); await clearFlow(user.id); return void ctx.reply("✅ День сделан выходным.", { reply_markup: adminKeyboard() }); } if (!match) return void ctx.reply("Формат: 09:00-18:00", { reply_markup: back() }); const start = Number(match[1]) * 60 + Number(match[2]), end = Number(match[3]) * 60 + Number(match[4]); if (start < 0 || end > 1440 || end <= start) return void ctx.reply("Укажите корректный период.", { reply_markup: back() }); const startsAt = studioDateTime(f.date!, start, cfg.timezone), endsAt = studioDateTime(f.date!, end, cfg.timezone); if (state === "day") await prisma.scheduleException.upsert({ where: { masterId_date: { masterId: f.masterId!, date: new Date(`${f.date}T00:00:00.000Z`) } }, update: { isDayOff: false, startMinutes: start, endMinutes: end }, create: { masterId: f.masterId!, date: new Date(`${f.date}T00:00:00.000Z`), isDayOff: false, startMinutes: start, endMinutes: end } }); else if (state === "addwin") await prisma.availabilityWindow.create({ data: { masterId: f.masterId!, startsAt, endsAt } }); else { const booking = await prisma.booking.findFirst({ where: { masterId: f.masterId!, status: { in: [...ACTIVE] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }, include: { client: true, pet: true } }); if (booking) return void ctx.reply(`⚠️ На это время уже есть запись: ${booking.client.firstName || "клиент"}, ${booking.pet.name}. Сначала отмените или перенесите её через «📋 Записи».`); await prisma.blockedTime.create({ data: { masterId: f.masterId!, startsAt, endsAt } }); } await clearFlow(user.id); return void ctx.reply(state === "addwin" ? "✅ Окно добавлено и доступно клиентам." : state === "block" ? "✅ Время заблокировано." : "✅ Часы дня сохранены.", { reply_markup: adminKeyboard() }); }
    return next();
  });
}
