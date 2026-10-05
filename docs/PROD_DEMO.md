# Прод-демо блока 5: обзервер на сервере + магазин на Vercel

Для ведущего. Что показываем: тот же Porto Shop, но «по-настоящему» — приложение на Vercel, обзервер на своём сервере,
деплой v1 → v2, детектор сам замечает регрессию, агенты (Gemini) расследуют. Участники только смотрят.

```
браузер ──► shop.vercel.app ──(сервер: OTLP + x-api-key)──────────────► https://observer.example.com ──► UI, чат, детектор
   └──(браузерные спаны → /__observe → маршрут-прокси на Vercel, ключ добавляется на сервере)──┘     (пароль для людей)
```

Пометки: **✅ проверено** локально в прод-режиме (`next build` + `next start`, шаг 44 журнала), **⚠️ не проверено** — сделать
на пробном деплое заранее, не в день воркшопа.

## 1. Сервер (дроплет)

Нужен Node.js ≥ 22.18, домен с A-записью на сервер, открыты только 80 и 443.

### Обзервер ✅

```bash
npx --yes next-observer@^0.3 collector --host 127.0.0.1 --port 4318 \
  --api-key "$OBSERVE_API_KEY" --ui-password "$OBSERVE_UI_PASSWORD"
```

- `--api-key` — для приложений (приём `/v1/traces`), `--ui-password` — для людей (UI, API, чат; браузер спросит
  пароль, имя любое). `/health` открыт для проверок доступности. Баннер показывает, что закрыто; без защиты на
  внешнем адресе — `WARNING`.
- Слушаем `127.0.0.1` — наружу выпускает только HTTPS-прокси (ниже).
- Настоящая модель: `OBSERVE_AI=real` и `GEMINI_API_KEY` + `GEMINI_MODEL`. Kitana (Claude/Codex CLI) на сервере не
  подойдёт — там нет залогиненного CLI. ✅ Gemini с настоящим ключом проверен 2026-10-05 (`next-observer` 0.3.16,
  локально на демо-данных): все четыре сценария — верные ответы за 5–10 с на `gemini-flash-lite-latest`. До 0.3.16 Gemini
  не работал вовсе (шаг 55 в логе). ⚠️ Для демо нужен ключ **с оплатой**: у бесплатного тарифа лимит на модель — несколько
  запросов в минуту (у `gemini-flash-latest` — 5), а расследование делает 7–12; обзервер ждёт лимит сам (до минуты),
  но на сцене это пауза. Ключ без кредитов отвечает 402 — чат скажет об этом прямо.
- Свой агент участника (`observe.agents.ts`) лежит в репозитории приложения, а обзервер — на сервере: чтобы он работал в
  проде, положить файл рядом с обзервером и запускать с `--root <папка с файлом>`. ✅ (локально: файл подхватывается из
  папки запуска, баннер `agents observe.agents.ts: …`).
- Данные в памяти: перезапуск обзервера = пустая история. Поднять заранее и не трогать до демо.

### systemd ⚠️

`/etc/systemd/system/next-observer.service`:

```ini
[Unit]
Description=next-observer
After=network-online.target

[Service]
User=observer
WorkingDirectory=/opt/observer
EnvironmentFile=/opt/observer/.env
ExecStart=/usr/bin/npx --yes next-observer@^0.3 collector --host 127.0.0.1 --port 4318
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

`/opt/observer/.env` (права 600):

```bash
OBSERVE_API_KEY=…            # длинная случайная строка: openssl rand -hex 24
OBSERVE_UI_PASSWORD=…        # пароль для зала не показывать — вводить заранее
OBSERVE_AI=real
GEMINI_API_KEY=…
GEMINI_MODEL=…
```

`sudo systemctl enable --now next-observer`, логи: `journalctl -u next-observer -f`. Путь к `npx` проверить
(`which npx`; при nvm он другой). `--root` в `ExecStart` не нужен — `WorkingDirectory` и есть корень.

### HTTPS: Caddy ⚠️

`/etc/caddy/Caddyfile`:

```
observer.example.com {
	reverse_proxy 127.0.0.1:4318
}
```

Caddy сам получает сертификат. Проверка: `curl https://observer.example.com/health` → `{"status":"ok",…}`;
`https://observer.example.com` в браузере → окно пароля.

## 2. Магазин на Vercel

### Подготовка репозитория ✅

От состояния финала (тег `block-4-agents`) — отдельная ветка для деплоя:

```bash
git checkout -B prod-demo block-4-agents
npx next-observer init --proxy      # добавит только маршрут-прокси: app/api/next-observe/[...path]/route.ts
git add -A && git commit -m "prod demo: runtime proxy route"
```

Маршрут-прокси нужен, чтобы браузерные спаны шли через сервер Vercel и ключ `x-api-key` добавлялся там, а адрес и ключ
читались при запуске, а не при сборке.

### Переменные окружения проекта на Vercel ✅

| Переменная | Значение |
|---|---|
| `OBSERVE_ENDPOINT` | `https://observer.example.com` |
| `OBSERVE_API_KEY` | тот же ключ, что у обзервера |
| `SHOP_VERSION` | `v1` (потом `v2` — это и есть «деплой с регрессией») |
| `OBSERVE_SERVICE_VERSION` | `v1` / `v2` — иначе версией будет SHA коммита (`VERCEL_GIT_COMMIT_SHA`), работает, но читается хуже |

Сборке адреса не нужны (✅ `next build` без них, в `routes-manifest` — только внутренний rewrite на маршрут-прокси).

### Отправка спанов из функций Vercel ⚠️

Функция Vercel может «заморозиться» сразу после ответа. По коду `@vercel/otel` 2.1.3: на старте корневого спана запроса
он регистрирует `waitUntil(… forceFlush())` — это отправляет все процессоры, включая наши. Но на настоящем Vercel это не
проверялось — **первая проверка пробного деплоя**: открыть магазин, через 5–10 секунд трейс есть в UI обзервера.

## 3. Демо

1. Задеплоить `SHOP_VERSION=v1`, `OBSERVE_SERVICE_VERSION=v1`. С ноутбука: `BASE_URL=https://<shop>.vercel.app npm run load 60`.
2. Поменять переменные на `v2`, **Redeploy**, снова `npm run load 60`.
3. UI обзервера (`https://observer.example.com`, пароль введён заранее): детектор сам поднимает `high_latency` по
   `POST /api/checkout` и `high_error_rate` по инвентарю — по одному расследованию на проблему.
4. В чате: *Did the last deployment make anything slower?* — ✅ локально в той же связке: «v1 → v2, `chargePayment` ×8.5,
   `lib/payment.ts`, внутри самой функции»; *Are the inventory errors new?* — «нет, были и в v1».

Холодные старты: каждый инстанс функции Vercel — свой `service.instance.id`, его первый запрос помечен `cold start` и не
портит статистику.

## 4. Если что-то сломалось на сцене

- Нет сети / Vercel недоступен → локально `npx next-observer@^0.3 collector --demo`: тот же сценарий (v1 → v2, ошибки
  инвентаря, N+1) с живым трафиком, детектор и агенты работают (✅ шаг 32).
- Обзервер перезапустился и потерял историю → снова шаги 1–2 демо (минуты 3).

## 5. Пробный деплой — заранее

- [ ] Сервер: обзервер под systemd, Caddy, `curl https://…/health`, окно пароля в браузере.
- [ ] Gemini: `OBSERVE_AI=real` с ключом **сервера** — вопрос в чат даёт отчёт (локально проверено 2026-10-05; на сервере — с его ключом и моделью).
- [ ] Vercel: трейсы из функций доходят (сервер и браузер), версии v1/v2 видны в `get_services`.
- [ ] Детектор: после редеплоя v2 сам поднимает регрессию оплаты.
- [ ] Свой агент на сервере (`observe.agents.ts` рядом с обзервером) — если хотим показать его в проде.
