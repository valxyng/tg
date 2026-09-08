# Лапуня — Telegram-бот для груминг-студии

«Лапуня» — Telegram-бот для онлайн-записи. Клиенты записываются в боте, а владелец управляет расписанием, услугами, ценами, мастерами и записями через защищённую Telegram-админку. Веб-админки нет.

## Требования

- Node.js **20.19.0** (the version is pinned in `.node-version`; Railway must use Node 20, not the local Node 24 runtime)
- PostgreSQL 16+ (Railway PostgreSQL подходит)
- Telegram-бот, созданный через [@BotFather](https://t.me/BotFather)

## Установка и локальная разработка

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:deploy
pnpm dev
```

Для локальной PostgreSQL можно запустить `docker compose up -d postgres`, создать `.env` из `.env.example` и задать `DATABASE_URL`.

`pnpm dev` запускает Next.js. Для тестирования бота без webhook отключите webhook в BotFather и отдельно выполните `pnpm bot`.

## Environment variables

| Переменная | Назначение |
| --- | --- |
| `DATABASE_URL` | Полная строка подключения PostgreSQL. |
| `TELEGRAM_BOT_TOKEN` | Token, полученный у BotFather. |
| `TELEGRAM_WEBHOOK_SECRET` | Случайная строка 32+ символов для проверки запросов Telegram. |
| `WEBHOOK_URL` | HTTPS base URL Railway без `/` в конце, например `https://lapunya-production.up.railway.app`. |
| `ADMIN_TELEGRAM_ID` | Числовой Telegram ID основного администратора. |
| `ADMIN_TELEGRAM_IDS` | Необязательные дополнительные числовые ID через запятую. |
| `CRON_SECRET` | Случайный секрет для защищённого HTTP запуска reminders. |
| `SEED_DEMO_DATA` | Только development: `true` создаёт демонстрационные данные. |

Не добавляйте `.env`, `.env.local`, токены, URL БД или секреты в Git. `.env.example` безопасен для коммита.

## База данных и миграции

В production используются только существующие Prisma migrations:

```bash
pnpm db:generate
pnpm db:deploy
```

Не используйте `prisma migrate reset` или `db push` для production базы. `pnpm db:deploy` — сокращение для безопасного применения миграций.

## Production

```bash
pnpm run build
pnpm start
```

`pnpm start` запускает Next.js и использует `PORT`, предоставленный Railway. HTTP проверка доступна по `GET /health`; при доступной БД она возвращает `{ "status": "ok" }`.

Telegram работает через единственный webhook: `POST /api/telegram/webhook`. Установите его после первого deploy:

```bash
pnpm webhook:set
```

Скрипт берёт URL только из `WEBHOOK_URL`, не содержит домена Railway в коде и передаёт Telegram secret token.

## Deploy на Railway

1. Создайте приватный GitHub repository и отправьте проект без `.env`.
2. В Railway выберите **New Project → Deploy from GitHub Repo** и подключите repository.
3. Нажмите **New → Database → PostgreSQL**. Railway добавит `DATABASE_URL` в проект; при необходимости привяжите её к приложению через `${{Postgres.DATABASE_URL}}`.
4. В сервисе приложения откройте **Variables** и добавьте значения из таблицы выше. `WEBHOOK_URL` появится после генерации домена.
5. В **Settings → Networking → Public Networking** создайте Railway domain, скопируйте `https://…up.railway.app` в `WEBHOOK_URL` и redeploy.
6. Railway применит `pnpm db:deploy` до запуска, затем выполнит `pnpm run build` и `pnpm start` по [railway.json](railway.json).
7. На доверенном компьютере с этими же ENV выполните `pnpm webhook:set`. В BotFather `/getWebhookInfo` должен показать URL `…/api/telegram/webhook` без ошибки.
8. Откройте `https://ВАШ-ДОМЕН/health`: ожидаемый ответ — `{ "status": "ok" }`.
9. Запустите бота с обычного аккаунта и проверьте запись. С аккаунта, чей ID указан в `ADMIN_TELEGRAM_ID` или `ADMIN_TELEGRAM_IDS`, проверьте кнопку **⚙️ Админ-панель**.
10. Для reminders создайте в Railway отдельный **Cron Job** из этого же repository с командой `pnpm reminders` и расписанием `*/5 * * * *`. Он использует ту же `DATABASE_URL` и bot token. Записи в `Notification` не позволят отправить напоминание повторно после рестарта.

## Первая настройка студии

В Telegram откройте **⚙️ Админ-панель**: заполните настройки, добавьте услуги и цены, добавьте мастеров, задайте рабочие часы/свободные окна, затем сделайте тестовую запись. Двойное бронирование защищено serializable транзакцией и PostgreSQL advisory lock.

## Production readiness

- [x] `pnpm run build` проходит.
- [x] `pnpm start` — production start command для Railway.
- [ ] PostgreSQL подключается — требуется Railway `DATABASE_URL`.
- [x] Prisma schema и migrations готовы; применяется `prisma migrate deploy`.
- [x] Telegram webhook защищён secret token и готов к настройке.
- [x] `/health` реализован.
- [ ] ENV настроены — требуется заполнение в Railway.
- [x] Секреты не находятся в исходном коде; `.env` игнорируется Git.
- [x] Admin ID проверяется серверно как строка ID.
- [x] Обычный пользователь не проходит admin handlers/callbacks.
- [x] Booking flow использует существующий service layer.
- [x] Double booking защищён транзакцией и advisory lock.
- [x] Notifications идемпотентны по `Notification` unique constraint.
- [x] SIGTERM/SIGINT закрывают Prisma connections.
- [x] Railway build, migration, start и health check описаны в `railway.json`.

## Pre-deployment checklist

- [x] Node.js 20.19.0 is pinned in `.node-version` and `package.json`.
- [x] pnpm 11.19.0 is pinned in `package.json`.
- [x] `package.json` and `pnpm-lock.yaml` are present.
- [x] `pnpm install --frozen-lockfile` completes without `approve-builds`.
- [ ] `pnpm exec prisma generate` after stopping all local bot/dev processes.
- [x] `pnpm run build` completed after the frozen install.
- [ ] `pnpm start` against Railway production ENV.
- [x] Required runtime ENV are validated on production startup.
- [x] Secrets are ignored by Git; `.env.example` has placeholders only.
- [ ] `ADMIN_TELEGRAM_ID` is configured in Railway Variables.
- [ ] Telegram webhook is installed for the Railway domain.
- [ ] `/health` is checked on the Railway domain.
- [ ] Railway PostgreSQL and `pnpm db:deploy` are checked.
- [x] Business timezone comes from `StudioSettings`, not server timezone.
- [x] Double booking is protected by a serializable transaction and PostgreSQL advisory lock.
- [x] Reminder delivery is idempotent through the `Notification` unique constraint.
- [x] SIGTERM/SIGINT close Prisma; standalone local polling also stops grammY.
- [x] Railway build, migration, start and health configuration are present.
