import "dotenv/config";
import { Bot, Context, InlineKeyboard, Keyboard } from "grammy";
import { prisma } from "../lib/db";
import { availableSlots, createBooking, SlotTakenError } from "../services/availability";
import { clock, dateInZone, studioDateTime } from "../lib/time";
import { money, settings } from "../lib/settings";
import { registerAdmin } from "./admin";

export const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN || "not-configured");
bot.use(async (ctx, next) => {
  if (!ctx.from) return next();
  const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) }, select: { isBlocked: true } });
  if (!user?.isBlocked) return next();
  if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Доступ ограничен", show_alert: true });
  else await ctx.reply("Доступ к боту ограничен. Свяжитесь с администратором.");
});
type Flow = { petId?: string; categoryId?: string; serviceId?: string; masterId?: string; date?: string; minutes?: number; editPetId?: string; name?: string; species?: string; phone?: string };
/** ADMIN_TELEGRAM_ID remains supported; ADMIN_TELEGRAM_IDS accepts a comma-separated allow-list. */
const ownerIds = () => [...new Set([process.env.ADMIN_TELEGRAM_ID, ...(process.env.ADMIN_TELEGRAM_IDS ?? "").split(",")]
  .filter((value): value is string => !!value && /^\d+$/.test(value.trim()))
  .map(value => BigInt(value.trim()).toString()))];
const ownerId = () => ownerIds()[0] ? BigInt(ownerIds()[0]) : null;
const isOwner = (ctx: Context) => !!ctx.from && ownerIds().includes(BigInt(ctx.from.id).toString());
const main = (admin = false) => { const keyboard = new Keyboard().text("📅 Записаться").text("💰 Прайс").row().text("✂️ Услуги").text("🐾 Мои питомцы").row().text("👤 Мой профиль").text("📋 Мои записи").row().text("📍 Где мы находимся").text("💬 Связаться с администратором"); if (admin) keyboard.row().text("⚙️ Админ-панель"); return keyboard.resized(); };
async function current(ctx: Context) {
  if (!ctx.from) throw new Error("Telegram user missing");
  return prisma.user.upsert({ where: { telegramId: BigInt(ctx.from.id) }, update: { username: ctx.from.username, firstName: ctx.from.first_name, lastName: ctx.from.last_name }, create: { telegramId: BigInt(ctx.from.id), username: ctx.from.username, firstName: ctx.from.first_name, lastName: ctx.from.last_name } });
}
async function flow(userId: string) { const x = await prisma.botFlow.findUnique({ where: { userId } }); return (x?.payload ?? {}) as Flow; }
async function setFlow(userId: string, state: string, payload: Flow = {}) { await prisma.botFlow.upsert({ where: { userId }, update: { state, payload }, create: { userId, state, payload } }); }
async function clearFlow(userId: string) { await prisma.botFlow.deleteMany({ where: { userId } }); }
async function menu(ctx: Context) { await ctx.reply("🐾 ЛАПУНЯ\n\nВыберите действие:", { reply_markup: main(isOwner(ctx)) }); }
const back = () => new InlineKeyboard().text("⬅️ Назад", "b:back").text("❌ Отмена", "b:cancel");
const speciesLabel = (species: string) => species === "cat" ? "🐱" : "🐶";
const phoneKeyboard = () => new Keyboard().requestContact("📱 Поделиться номером").row().text("❌ Отмена").resized();

async function promptRegistration(ctx: Context) {
  await ctx.reply("🐾 <b>Добро пожаловать в «Лапуню»!</b>\n\nСоздайте профиль, чтобы сохранять ваши данные, питомцев и историю записей.", { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("✨ Создать профиль", "b:register") });
}
async function profile(ctx: Context, userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { _count: { select: { pets: { where: { isArchived: false } }, bookings: true } } } });
  await ctx.reply(`👤 <b>МОЙ ПРОФИЛЬ</b>\n\nИмя: ${u.firstName || "—"}\n📱 Телефон: ${u.phone || "—"}\n\n🐾 Питомцев: ${u._count.pets}\n📅 Записей: ${u._count.bookings}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🐾 Мои питомцы", "b:pets").text("📅 Мои записи", "b:bookings").row().text("✏️ Изменить данные", "b:profileedit").row().text("◀️ Назад", "b:menu") });
}
async function petsList(ctx: Context, userId: string) {
  const pets = await prisma.pet.findMany({ where: { ownerId: userId, isArchived: false }, orderBy: { name: "asc" } });
  const kb = new InlineKeyboard(); pets.forEach(p => kb.text(`${speciesLabel(p.species)} ${p.name}${p.breed ? ` — ${p.breed}` : ""}`, `b:petcard:${p.id}`).row());
  kb.text("➕ Добавить питомца", "b:petadd").row().text("◀️ Назад", "b:profile");
  await ctx.reply(pets.length ? `🐾 <b>МОИ ПИТОМЦЫ</b>\n\n${pets.map(p => `${speciesLabel(p.species)} ${p.name}\n${p.breed || "Порода не указана"}`).join("\n\n")}` : "🐾 Питомцев пока нет.", { parse_mode: "HTML", reply_markup: kb });
}
async function petCard(ctx: Context, userId: string, petId: string) {
  const pet = await prisma.pet.findFirst({ where: { id: petId, ownerId: userId, isArchived: false }, include: { owner: true, bookings: { include: { service: true }, orderBy: { startsAt: "desc" }, take: 10 } } });
  if (!pet) return void ctx.reply("Питомец не найден.");
  const history = pet.bookings.map(b => `${b.startsAt.toLocaleDateString("ru-RU")} — ${b.service.name} — ${money(b.priceKopecks)}`).join("\n") || "Записей пока нет.";
  await ctx.reply(`${speciesLabel(pet.species)} <b>${pet.name.toUpperCase()}</b>\n\nПорода: ${pet.breed || "Не указана"}\nВладелец: ${pet.owner.firstName || "—"}\n\n📋 История записей:\n${history}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("📅 Записать на груминг", `b:bookpet:${pet.id}`).row().text("✏️ Изменить", `b:pe:${pet.id}`).text("🗑 Удалить", `b:petremove:${pet.id}`).row().text("◀️ Назад", "b:pets") });
}

async function choosePet(ctx: Context, userId: string) {
  const pets = await prisma.pet.findMany({ where: { ownerId: userId, isArchived: false }, orderBy: { name: "asc" } });
  const kb = new InlineKeyboard(); pets.forEach(p => kb.text(`🐾 ${p.name}${p.breed ? ` · ${p.breed}` : ""}`, `b:p:${p.id}`).row());
  kb.text("➕ Добавить питомца", "b:petadd").row().text("❌ Отмена", "b:cancel");
  await ctx.reply(pets.length ? "Выберите питомца:" : "Давайте сначала добавим питомца 🐾", { reply_markup: kb });
}
async function chooseCategory(ctx: Context, userId: string, f: Flow) {
  const categories = await prisma.serviceCategory.findMany({ where: { isArchived: false, services: { some: { isActive: true, isArchived: false } } }, orderBy: { sortOrder: "asc" } });
  const kb = new InlineKeyboard(); categories.forEach(x => kb.text(x.name, `b:c:${x.id}`).row()); kb.text("⬅️ Назад", "b:back").text("❌ Отмена", "b:cancel");
  await setFlow(userId, "category", f); await ctx.reply("Выберите категорию услуг:", { reply_markup: kb });
}
async function chooseService(ctx: Context, userId: string, f: Flow) {
  const pet = await prisma.pet.findFirstOrThrow({ where: { id: f.petId!, ownerId: userId } });
  const services = await prisma.service.findMany({ where: { categoryId: f.categoryId!, isActive: true, isArchived: false, animalTypes: { has: pet.species } }, orderBy: { sortOrder: "asc" } });
  const kb = new InlineKeyboard(); services.forEach(x => kb.text(`${x.name} — ${money(x.priceKopecks)}`, `b:s:${x.id}`).row()); kb.text("⬅️ Назад", "b:back").text("❌ Отмена", "b:cancel");
  await setFlow(userId, "service", f); await ctx.reply(services.length ? "Выберите услугу:" : "Для этого питомца пока нет доступных услуг.", { reply_markup: kb });
}
async function chooseMaster(ctx: Context, userId: string, f: Flow) {
  const masters = await prisma.master.findMany({ where: { isActive: true, isArchived: false, services: { some: { serviceId: f.serviceId } } }, orderBy: { name: "asc" } });
  const kb = new InlineKeyboard(); masters.forEach(x => kb.text(`👩 ${x.name}`, `b:m:${x.id}`).row()); kb.text("⬅️ Назад", "b:back").text("❌ Отмена", "b:cancel");
  await setFlow(userId, "master", f); await ctx.reply("Выберите мастера:", { reply_markup: kb });
}
async function chooseDate(ctx: Context, userId: string, f: Flow) {
  const cfg = await settings(), kb = new InlineKeyboard(), today = dateInZone(new Date(), cfg.timezone);
  for (let i = 0; i < 21; i++) { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); const value = d.toISOString().slice(0,10); kb.text(new Intl.DateTimeFormat("ru-RU", { day:"numeric", month:"short", timeZone:"UTC" }).format(d), `b:d:${value}`); if (i % 3 === 2) kb.row(); }
  kb.row().text("⬅️ Назад", "b:back").text("❌ Отмена", "b:cancel"); await setFlow(userId, "date", f); await ctx.reply("Выберите дату:", { reply_markup: kb });
}
async function chooseTime(ctx: Context, userId: string, f: Flow) {
  const slots = await availableSlots(f.masterId!, f.serviceId!, f.date!); const kb = new InlineKeyboard();
  slots.forEach((x,i) => { kb.text(clock(x.minutes), `b:t:${x.minutes}`); if (i % 4 === 3) kb.row(); }); kb.row().text("⬅️ Назад", "b:back").text("❌ Отмена", "b:cancel");
  await setFlow(userId, "time", f); await ctx.reply(slots.length ? "Выберите свободное время:" : "На эту дату свободных окон нет. Выберите другую дату.", { reply_markup: kb });
}
async function confirmation(ctx: Context, userId: string, f: Flow) {
  const [pet, service, master, cfg] = await Promise.all([prisma.pet.findUniqueOrThrow({where:{id:f.petId!}}), prisma.service.findUniqueOrThrow({where:{id:f.serviceId!}}), prisma.master.findUniqueOrThrow({where:{id:f.masterId!}}), settings()]);
  await setFlow(userId, "confirm", f); await ctx.reply(`📋 ПРОВЕРЬТЕ ЗАПИСЬ\n\n🐶 ${pet.name}\n✂️ ${service.name}\n👩 ${master.name}\n📅 ${f.date}\n🕐 ${clock(f.minutes!)}\n💰 ${money(service.priceKopecks, cfg.currency)}\n📍 ${cfg.address || "адрес уточняется"}`, { reply_markup: new InlineKeyboard().text("✅ Подтвердить", "b:ok").row().text("✏️ Изменить время", "b:back").text("❌ Отмена", "b:cancel") });
}

bot.command(["start", "menu", "help"], async ctx => { const u = await current(ctx), cfg = await settings(); await clearFlow(u.id); if (!u.profileCompleted) return void promptRegistration(ctx); await ctx.reply(ctx.match === "help" ? "Нажимайте кнопки меню — я помогу оформить запись." : cfg.welcomeText, { reply_markup: main(isOwner(ctx)) }); });
bot.hears("📅 Записаться", async ctx => { const u = await current(ctx); if (!u.profileCompleted) return void promptRegistration(ctx); await clearFlow(u.id); await choosePet(ctx, u.id); });
bot.hears("💰 Прайс", async ctx => { await current(ctx); const cats = await prisma.serviceCategory.findMany({ where:{isArchived:false}, include:{services:{where:{isActive:true,isArchived:false},orderBy:{sortOrder:"asc"}}},orderBy:{sortOrder:"asc"} }); await ctx.reply(cats.map(c=>`<b>${c.name}</b>\n${c.services.map(s=>`• ${s.name} — ${money(s.priceKopecks)}`).join("\n")}`).join("\n\n") || "Прайс пока заполняется.", { parse_mode:"HTML" }); });
bot.hears("✂️ Услуги", async ctx => { await current(ctx); const list=await prisma.service.findMany({where:{isActive:true,isArchived:false},orderBy:{sortOrder:"asc"}}); await ctx.reply(list.map(s=>`✂️ <b>${s.name}</b>\n${s.description||""}\n⏱ ${s.durationMinutes} мин. · 💰 ${money(s.priceKopecks)}`).join("\n\n") || "Услуги пока заполняются.",{parse_mode:"HTML"}); });
bot.hears(["🐶 Мои питомцы", "🐾 Мои питомцы"], async ctx => { const u=await current(ctx); if (!u.profileCompleted) return void promptRegistration(ctx); await petsList(ctx, u.id); });
bot.hears("👤 Мой профиль", async ctx => { const u=await current(ctx); if (!u.profileCompleted) return void promptRegistration(ctx); await profile(ctx, u.id); });
bot.hears("📋 Мои записи", async ctx => { const u=await current(ctx); if (!u.profileCompleted) return void promptRegistration(ctx); const rows=await prisma.booking.findMany({where:{clientId:u.id,startsAt:{gte:new Date()},status:{in:["PENDING","CONFIRMED"]}},include:{pet:true,service:true,master:true},orderBy:{startsAt:"asc"}}); const kb=new InlineKeyboard(); rows.forEach(b=>kb.text(`❌ Отменить ${b.pet.name} · ${b.startsAt.toLocaleDateString("ru-RU")}`,`b:x:${b.id}`).row()); await ctx.reply(rows.length?rows.map(b=>`${speciesLabel(b.pet.species)} ${b.pet.name}\n✂️ ${b.service.name}\n👩 ${b.master.name}\n📅 ${b.startsAt.toLocaleString("ru-RU")}`).join("\n\n"):"Предстоящих записей нет.",{reply_markup:kb}); });
bot.hears("📍 Где мы находимся", async ctx=>{const c=await settings(); const kb=new InlineKeyboard();if(c.mapUrl)kb.url("🗺 Открыть карту",c.mapUrl);await ctx.reply(`📍 ${c.name}\n${c.address}\n${c.directions||""}`,{reply_markup:kb});});
bot.hears("💬 Связаться с администратором",async ctx=>{const c=await settings(); await ctx.reply(c.adminUsername?`Напишите администратору: @${c.adminUsername.replace("@","")}`:c.phone?`Телефон: ${c.phone}`:"Контакты скоро появятся.");});

bot.callbackQuery(/^b:(.+)$/, async ctx => { const u=await current(ctx), [kind,...rest]=ctx.match[1].split(":"); const value=rest.join(":"); const row=await prisma.botFlow.findUnique({where:{userId:u.id}}); const f=(row?.payload??{}) as Flow; await ctx.answerCallbackQuery();
  if(kind==="cancel"){await clearFlow(u.id);await ctx.reply("Сценарий отменён.",{reply_markup:main(isOwner(ctx))});return;}
  if(kind==="register"){await clearFlow(u.id);await setFlow(u.id,"registration_name");await ctx.reply("👤 Как вас зовут?");return;}
  if(kind==="regpet"){await setFlow(u.id,"registration_pet_name",{species:value});await ctx.reply("🐾 Как зовут вашего питомца?");return;}
  if(kind==="regskip"){await prisma.user.update({where:{id:u.id},data:{profileCompleted:true}});await clearFlow(u.id);await ctx.reply("🎉 <b>Профиль создан!</b>\n\nТеперь вы можете записаться на груминг 💛",{parse_mode:"HTML",reply_markup:main(isOwner(ctx))});return;}
  if(kind==="menu"){await menu(ctx);return;}
  if(kind==="profile"){await profile(ctx,u.id);return;}
  if(kind==="pets"){await petsList(ctx,u.id);return;}
  if(kind==="bookings"){const rows=await prisma.booking.findMany({where:{clientId:u.id},include:{pet:true,service:true},orderBy:{startsAt:"desc"},take:20});await ctx.reply(rows.length?rows.map(b=>`${b.startsAt.toLocaleDateString("ru-RU")} — ${b.pet.name} — ${b.service.name}`).join("\n"):"Записей пока нет.",{reply_markup:new InlineKeyboard().text("◀️ Назад","b:profile")});return;}
  if(kind==="profileedit"){await setFlow(u.id,"profile_edit_name");await ctx.reply("👤 Введите новое имя:");return;}
  if(kind==="petcard"){await petCard(ctx,u.id,value);return;}
  if(kind==="bookpet"){const pet=await prisma.pet.findFirst({where:{id:value,ownerId:u.id,isArchived:false}});if(!pet)return;await chooseCategory(ctx,u.id,{petId:pet.id});return;}
  if(kind==="petremove"){const pet=await prisma.pet.findFirst({where:{id:value,ownerId:u.id,isArchived:false}});if(!pet)return;await ctx.reply("⚠️ Удалить питомца?\nИстория его записей сохранится.",{reply_markup:new InlineKeyboard().text("❌ Отмена","b:pets").text("✅ Удалить",`b:petdelete:${value}`)});return;}
  if(kind==="petdelete"){const pet=await prisma.pet.findFirst({where:{id:value,ownerId:u.id,isArchived:false}});if(!pet)return;await prisma.pet.update({where:{id:pet.id},data:{isArchived:true}});await ctx.reply("Питомец удалён. История записей сохранена.",{reply_markup:new InlineKeyboard().text("◀️ К питомцам","b:pets")});return;}
  if(kind==="p"){await chooseCategory(ctx,u.id,{petId:value});return;}
  if(kind==="c"){await chooseService(ctx,u.id,{...f,categoryId:value});return;}
  if(kind==="s"){await chooseMaster(ctx,u.id,{...f,serviceId:value});return;}
  if(kind==="m"){await chooseDate(ctx,u.id,{...f,masterId:value});return;}
  if(kind==="d"){await chooseTime(ctx,u.id,{...f,date:value});return;}
  if(kind==="t"){await confirmation(ctx,u.id,{...f,minutes:Number(value)});return;}
  if(kind==="ok"){try {const cfg=await settings();const booking=await createBooking({clientId:u.id,petId:f.petId!,serviceId:f.serviceId!,masterId:f.masterId!,startsAt:studioDateTime(f.date!,f.minutes!,cfg.timezone)});await clearFlow(u.id);await ctx.reply(`✅ ЗАПИСЬ ПОДТВЕРЖДЕНА\n\n🐶 ${booking.pet.name}\n✂️ ${booking.service.name}\n👩 ${booking.master.name}\n📅 ${f.date}\n🕐 ${clock(f.minutes!)}\n💰 ${money(booking.priceKopecks,cfg.currency)}\n\n${cfg.bookingSuccessText}`,{reply_markup:main(isOwner(ctx))}); const text=`🆕 НОВАЯ ЗАПИСЬ\n\nКлиент: ${booking.client.firstName||"Клиент"}\nПитомец: ${booking.pet.name}\nУслуга: ${booking.service.name}\nМастер: ${booking.master.name}\nДата: ${f.date}\nВремя: ${clock(f.minutes!)}`; const actions=new InlineKeyboard().text("✅ Подтвердить",`a:confirm:${booking.id}`).text("❌ Отменить",`a:cancel:${booking.id}`); if(ownerId()) await bot.api.sendMessage(String(ownerId()),text,{reply_markup:actions});}catch(e){await ctx.reply(e instanceof SlotTakenError?"❌ К сожалению, это время уже заняли. Выберите другое.":"Не удалось создать запись. Попробуйте ещё раз.");}return;}
  if(kind==="x"){const b=await prisma.booking.findFirst({where:{id:value,clientId:u.id,status:{in:["PENDING","CONFIRMED"]}}});if(b){await prisma.booking.update({where:{id:b.id},data:{status:"CANCELLED"}});await ctx.reply("❌ Запись отменена.");}return;}
  if(kind==="petadd"){await setFlow(u.id,"pet_name");await ctx.reply("🐾 Как зовут вашего питомца?");return;}
  if(kind==="pe"){const pet=await prisma.pet.findFirst({where:{id:value,ownerId:u.id,isArchived:false}});if(!pet)return;await setFlow(u.id,"pet_name",{editPetId:value,species:pet.species});await ctx.reply("Введите новое имя питомца:");return;}
  if(kind==="species"){await setFlow(u.id,"pet_breed",{...f,species:value});await ctx.reply("🐕 Какая порода?\nМожно отправить «Не знаю».");return;}
  if(kind==="back"){if(row?.state==="confirm")await chooseTime(ctx,u.id,f);else if(row?.state==="time")await chooseDate(ctx,u.id,f);else if(row?.state==="date")await chooseMaster(ctx,u.id,f);else if(row?.state==="master")await chooseService(ctx,u.id,f);else await choosePet(ctx,u.id);}
});
bot.callbackQuery(/^a:(confirm|cancel):(.+)$/, async ctx => { if (!isOwner(ctx)) { await ctx.answerCallbackQuery({text:"Недостаточно прав",show_alert:true}); return; } const [,action,id]=ctx.match; const booking=await prisma.booking.findFirst({where:{id,status:{in:["PENDING","CONFIRMED"]}},include:{client:true,pet:true,service:true,master:true}}); if(!booking){await ctx.answerCallbackQuery({text:"Запись уже обработана"});return;} const status=action==="confirm"?"CONFIRMED":"CANCELLED"; await prisma.booking.update({where:{id},data:{status}}); const cfg=await settings(); await bot.api.sendMessage(String(booking.client.telegramId),action==="confirm"?`✅ Ваша запись подтверждена\n\n${booking.service.name}\n${booking.master.name}\n${booking.startsAt.toLocaleString("ru-RU",{timeZone:cfg.timezone})}`:`❌ Ваша запись отменена администратором. Пожалуйста, выберите другое время.`); await ctx.answerCallbackQuery({text:action==="confirm"?"Запись подтверждена":"Запись отменена"}); await ctx.editMessageReplyMarkup(); });
registerAdmin(bot, isOwner, main);
async function finishRegistration(ctx: Context, userId: string, pet?: { name: string; species: string; breed: string | null }) {
  await prisma.user.update({ where: { id: userId }, data: { profileCompleted: true } });
  await clearFlow(userId);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await ctx.reply(`🎉 <b>Профиль создан!</b>\n\n👤 ${user.firstName || "—"}${pet ? `\n\n🐾 Питомец:\n${speciesLabel(pet.species)} ${pet.name}\n${pet.breed || "Порода не указана"}` : ""}\n\nТеперь вы можете записаться на груминг 💛`, { parse_mode: "HTML", reply_markup: main(isOwner(ctx)) });
}
async function saveRegistrationPhone(ctx: Context, userId: string, phone: string) {
  const normalized = phone.trim();
  if (normalized.length < 5) return void ctx.reply("Укажите корректный номер телефона.", { reply_markup: phoneKeyboard() });
  await prisma.user.update({ where: { id: userId }, data: { phone: normalized } });
  await setFlow(userId, "registration_pet_choice");
  await ctx.reply("🐾 <b>Добавим вашего питомца?</b>", { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🐶 Добавить собаку", "b:regpet:dog").row().text("🐱 Добавить кошку", "b:regpet:cat").row().text("⏭️ Пропустить", "b:regskip") });
}
bot.on("message:contact", async ctx => { const u = await current(ctx); const row = await prisma.botFlow.findUnique({ where: { userId: u.id } }); const contact = ctx.message.contact; if (contact.user_id && contact.user_id !== ctx.from.id) return void ctx.reply("Пожалуйста, отправьте свой номер телефона.", { reply_markup: phoneKeyboard() }); if (row?.state === "registration_phone") return void saveRegistrationPhone(ctx, u.id, contact.phone_number); if (row?.state === "profile_edit_phone") { const f = row.payload as Flow; await prisma.user.update({ where: { id: u.id }, data: { firstName: f.name, phone: contact.phone_number } }); await clearFlow(u.id); await ctx.reply("✅ Данные обновлены.", { reply_markup: main(isOwner(ctx)) }); } });
bot.on("message:text", async ctx=>{ const u=await current(ctx), row=await prisma.botFlow.findUnique({where:{userId:u.id}}); if(!row)return; const f=row.payload as Flow, text=ctx.message.text.trim();
  if(row.state==="registration_name"){if(text.length<2)return void ctx.reply("Введите, пожалуйста, имя.");await prisma.user.update({where:{id:u.id},data:{firstName:text}});await setFlow(u.id,"registration_phone");await ctx.reply("📱 Укажите номер телефона.",{reply_markup:phoneKeyboard()});return;}
  if(row.state==="registration_phone"){await saveRegistrationPhone(ctx,u.id,text);return;}
  if(row.state==="registration_pet_name"){if(!text)return;await setFlow(u.id,"registration_pet_breed",{...f,name:text});await ctx.reply("🐕 Какая порода?\nМожно отправить «Не знаю».");return;}
  if(row.state==="registration_pet_breed"){const pet={name:f.name!,species:f.species!,breed:["не знаю","—"].includes(text.toLowerCase())?null:text};await prisma.pet.create({data:{ownerId:u.id,...pet}});await finishRegistration(ctx,u.id,pet);return;}
  if(row.state==="profile_edit_name"){if(text.length<2)return void ctx.reply("Введите, пожалуйста, имя.");await setFlow(u.id,"profile_edit_phone",{name:text});await ctx.reply("📱 Укажите новый номер телефона.",{reply_markup:phoneKeyboard()});return;}
  if(row.state==="profile_edit_phone"){if(text.length<5)return void ctx.reply("Укажите корректный номер телефона.");await prisma.user.update({where:{id:u.id},data:{firstName:f.name,phone:text}});await clearFlow(u.id);await ctx.reply("✅ Данные обновлены.",{reply_markup:main(isOwner(ctx))});return;}
  if(row.state==="pet_name"){if(!text)return;await setFlow(u.id,"pet_species",{...f,name:text});await ctx.reply("Выберите вид животного:",{reply_markup:new InlineKeyboard().text("🐶 Собака","b:species:dog").text("🐱 Кошка","b:species:cat")});return;}
  if(row.state==="pet_breed"){const petData={name:f.name!,species:f.species!,breed:["—","не знаю"].includes(text.toLowerCase())?null:text};if(f.editPetId)await prisma.pet.update({where:{id:f.editPetId},data:petData});else await prisma.pet.create({data:{ownerId:u.id,...petData}});await clearFlow(u.id);await ctx.reply("🐾 Питомец сохранён.",{reply_markup:main(isOwner(ctx))});} });
bot.catch(err=>console.error("Telegram update error",err.error));
export async function startPolling() { if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is required"); await bot.start({ onStart: () => console.log("Telegram polling started") }); }
if (require.main === module) {
  const shutdown = async (signal: string) => { console.log(`Received ${signal}; stopping Telegram polling`); await bot.stop(); await prisma.$disconnect(); process.exit(0); };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  void startPolling();
}
