# Журнал шагов — next-observe

Каждый шаг записан в формате: **чтобы** получить X → **делаем** Y → **что получили / что узнали**.
Журнал — основа сценария воркшопа (Porto 2026): участники проходят те же шаги в том же порядке.

Стенд: Next.js 16.3.7 (Turbopack), React 19.3.0, TypeScript 7, `@vercel/otel` 2.1.3, Node 24.
Проект-полигон: `vercel-otel-test/`.

---

## Шаг 0. Что умеет `@vercel/otel` из коробки

**Чтобы** понять, что нам нужно дописать самим,
**делаем** пустой Next-проект с `instrumentation.ts` → `registerOTel()` и страницы на всех рантаймах: Node, Edge, SSG, клиентский компонент.

**Узнали:**
- `@vercel/otel` работает только на сервере. `import('@vercel/otel')` в браузере ломает сборку: `Can't resolve 'module'`.
- Next сам создаёт спаны своих внутренностей (`GET /`, `render route (app)`, `build component tree`…), как только зарегистрирован OTel-провайдер.
- В браузере `@opentelemetry/api` работает после регистрации `WebTracerProvider` в `instrumentation-client.ts`: этот файл Next выполняет до гидрации.
- SSG-страницы выполняют серверный код только при `next build`, в рантайме от них спанов нет.

**Вывод:** сервер берём у `@vercel/otel`. Клиент и инструментацию собственного кода пишем сами.

---

## Шаг 1. Имя и форма пакета

**Чтобы** CLI было коротким и пакет можно было опубликовать,
**делаем** проверку имён на npm.

**Решили:**
- Пакет `next-observe`, в bin два имени: `next-observe` и короткий алиас `nxo`.
- Scope `@nextjs/*` не используем: он нам не принадлежит, а «Next.js» — торговая марка Vercel.
- Один пакет с subpath-экспортами: `next-observe/server`, `next-observe/client`, `next-observe/config`, `next-observe/debug`.

---

## Шаг 2. Как снимать метрики React в проде

**Чтобы** видеть рендеры и тайминги компонентов в проде, а не только в dev,
**делаем** разбор того, что React отдаёт наружу в прод-сборке.

**Узнали:**
- В прод-сборке React вызывает `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot` на каждый коммит. Из этого вызова видно, какие компоненты рендерились и почему.
- Тайминги (`actualDuration`, `selfBaseDuration`) есть только в profiling-сборке React. В Next 16 она включается **только флагом CLI** `next build --profile`, опции в `next.config` нет.
- Имена компонентов минификатор портит независимо от `--profile`. Нужен `displayName`, его проставляет наш трансформ (шаг 3).

**Решили:** `--profile` включён по умолчанию, но отключается опцией. UI показывает, в каком режиме собрано приложение.

---

## Шаг 3. Директива `'use observe'`

**Чтобы** инструментировать собственный код без ручных обёрток,
**делаем** директиву по аналогии с `'use client'`, `'use server'` и `'use cache'`:

```ts
'use observe'                      // уровень файла: все экспорты
export default async function Page() { ... }
```
```ts
export async function loadData() {
  'use observe'                    // уровень функции: только эта функция
}
```

### 3.1 Loader для Turbopack

Babel подключаем **как библиотеку внутри loader**, без babel-конфига в проекте, поэтому Next остаётся на SWC.

```ts
// next.config.ts
turbopack: {
  rules: {
    '*.{ts,tsx}': {
      condition: { all: [{ not: 'foreign' }, { content: /['"]use observe['"]/ }] },
      loaders: [observeLoader],
    },
  },
}
```

`condition.content` запускает loader только на файлах, где встречается директива. `not: 'foreign'` пропускает `node_modules`.

### 3.2 Трансформ

Тело функции переносится в стрелку и передаётся в `__observe.run()`:

```ts
// было
export async function loadData() { 'use observe'; ... }
// стало
import { __observe } from '../../observe-poc/runtime'
export async function loadData() {
  return __observe.run('loadData', 'function', 'app/observe/lib.ts', async () => { ... })
}
```

Сохраняются имя функции, hoisting, `this`, `arguments` и остальные директивы (`'use server'`). Компонентам (имя с заглавной буквы) добавляется `X.displayName = 'X'`.

### 3.3 Runtime

- **Сервер:** `tracer.startActiveSpan()`. Спан становится дочерним к спанам Next.
- **Браузер, компоненты:** `performance.now()` вокруг рендера. Замеры агрегируются по компоненту (count / total / max) и раз в 5s уходят одним спаном `react.renders`: спан на каждый рендер завалил бы коллектор.

### 3.4 Мини-коллектор

Файл `observe-poc/collector.mjs`: OTLP/HTTP JSON на `:4318`, с CORS для браузера. Печатает спаны и пишет их в `spans.jsonl`. Это заготовка будущего сервера.

### Как повторить

```bash
cd vercel-otel-test
node observe-poc/collector.mjs          # терминал 1
OBSERVE_DEBUG=1 npx next dev            # терминал 2, печатает результат трансформа
open http://localhost:3000/observe      # кликнуть кнопки
```

### Что получили

```
GET /observe
└ render route (app) /observe
  ├ render ObservePage   30.9ms
  │ └ loadData           30.8ms
  ├ render Counter  (SSR)
  └ render Badge    (SSR)
```

- Server action: браузерный `fetch POST` → `POST /observe` → `increment` образуют **один трейс**.
- Браузер: `react.renders { Counter.count: 2, total_ms: 4, max_ms: 2 }`.
- Прод (`next build --profile && next start`): все спаны на месте, `displayName` пережил минификацию.
- `actualDuration` в клиентском бандле: 0 упоминаний без `--profile`, 21 с `--profile`.

### Что узнали

- Next не ругается на неизвестную директиву, даже без loader.
- `'use client'` / `'use server'` остаются первыми, проверки Next для server actions проходят.
- Turbopack не резолвит абсолютные пути в `import`, которые добавил loader. В пакете будет `next-observe/runtime`.
- Статическая страница (○) не даёт серверных спанов в рантайме. Для теста понадобилось `export const dynamic = 'force-dynamic'`.
- Спан компонента на сервере меряет **только тело функции**. Дети рендерятся после возврата родителя, поэтому `Counter` оказался соседом `ObservePage`, а не дочерним.
- Клиентский `documentLoad` не связан с серверным `GET`, это разные трейсы. Нужно передать `traceparent` в HTML.

### Babel или SWC

**Чтобы** трансформ шёл внутри компилятора Next, а не через loader,
**проверили** поддержку SWC-плагинов: в Next 16.3.7 внутри Turbopack есть `swc_plugin_runner 30.0.1`, так что `experimental.swcPlugins` работает.

**Решили:** пока остаёмся на Babel. Причины:
- ABI плагина привязан к версии `swc_core` в Next.
- Плагин запускается на каждом модуле, а loader — только на файлах с директивой.
- Код на Rust тяжелее для воркшопа.

SWC-плагин записан в бэклог спринтов (`SPRINTS.md` → «Backlog — SWC plugin»). Babel-версия остаётся учебной.

---

## Шаг 4. Как это распространяется и где работает

**Чтобы** подключение занимало одну команду, а в облаке работало без CLI,
**делаем** такой дизайн:

- `npx next-observe init` запускается один раз. Команда ставит пакет, оборачивает `next.config` в `withObserve()`, создаёт `instrumentation.ts` и `instrumentation-client.ts`, меняет build-скрипт на `"build": "next build --profile"`. Всё это коммитится в репозиторий.
- Без правки `next.config` не обойтись: у Next нет флага `--config`, он читает только `next.config.{js,mjs,ts,mts}` из корня.
- Babel лежит внутри пакета и работает только во время сборки, в бандл не попадает.
- **Локально:** `nxo dev` поднимает observer (коллектор + UI) рядом с `next dev`.
- **Облако (Vercel):** нужны только `OBSERVE_ENDPOINT` и `OBSERVE_API_KEY` в env. Флаг `--profile` приходит через build-скрипт.

**Где живёт observer в проде:** на дроплете, не на Vercel. На Vercel каждый батч спанов — платный вызов функции, нет постоянного процесса для SQLite и детектора аномалий. Дроплет — это фиксированная цена и один долгоживущий процесс. HTTPS без своего домена: Caddy + `<ip>.sslip.io`.

**Формат воркшопа (3 часа):** участники работают только локально. Прод (приложение на Vercel + observer на дроплете) — демо ведущего, поднимается заранее.

---

## Шаг 5. POC → пакет `next-observe` с `withObserve()`

**Чтобы** пользователь подключал инструментацию одной строкой в `next.config`, а не копировал loader,
**делаем** пакет `nextjs-observe/packages/next-observe` и переносим в него трансформ, loader и runtime из POC.

**Архитектурные решения, принятые на этом шаге:**
- Агенты работают в процессе observer (`nxo dev`), а не в приложении.
- UI observer — готовый статический SPA, его раздаёт коллектор.
- Хранилище — в памяти + `node:sqlite`. Нативный `better-sqlite3` на Windows у участников падал бы при установке. Отсюда требование Node 22+.
- Пакет один, с subpath-экспортами. Монорепо пока не нужно.

### Структура пакета

```
next-observe/
  src/config.ts            withObserve(nextConfig)        → next-observe/config
  src/runtime.ts           __observe.run()                → next-observe/runtime
  src/transform/plugin.ts  Babel-плагин директивы
  src/transform/index.ts   transformObserve() — общий для loader и тестов
  src/transform/loader.cts loader (CommonJS, ESM-трансформ через import())
```

Подключение у пользователя:

```ts
// next.config.ts
import { withObserve } from 'next-observe/config'
export default withObserve({ /* обычный конфиг */ })
```

`withObserve()`:
- добавляет правило `turbopack.rules['*.{js,jsx,ts,tsx,mjs,mts}']` с `condition: { not: 'foreign' } + { content: /use observe/ }`;
- не трогает остальной конфиг и чужие правила;
- если на тот же glob уже есть правило пользователя, превращает его в массив, а не заменяет;
- поддерживает и конфиг-функцию `(phase) => config`.

Трансформ теперь вставляет `import { __observe } from "next-observe/runtime"`, это обычный bare-импорт из `node_modules`.

### Как тестировали

**1. Юнит-тесты (vitest), 23 теста:**
- трансформ: уровень файла и функции, что оборачивается, а что нет (не экспортированные, вложенные, генераторы), `'use client'` и `'use server'` остаются первыми, inline `'use server'`, стрелки с выражением, `displayName` только у компонентов, путь относительно корня. Результат каждый раз парсится Babel, чтобы убедиться, что код валиден;
- runtime на **настоящем** OTel-провайдере с `InMemorySpanExporter`: sync и async, спан закрывается только после promise, ошибки и reject дают статус `ERROR` + `exception`, вложенность parent → child, в браузере агрегация рендеров по таймеру;
- `withObserve`: правило, сохранение чужого конфига, слияние с правилом на том же glob, отсутствие мутации входного конфига, конфиг-функция.

**2. Проверка самих тестов.** Намеренно ломали код: плагин не вырезает директиву — упали 3 теста; runtime не ждёт promise — упали 2. Код вернули, снова 23 из 23.

**3. Сквозной тест как у пользователя.** `npm pack` → `npm install next-observe-0.0.1.tgz` в `vercel-otel-test` (копия, не симлинк, как из npm) → `next.config` с `withObserve()`. Затем открыть `/observe`, два клика, server action. Скрипт `observe-poc/verify.mjs` проверяет 10 утверждений по `spans.jsonl`.

```bash
cd nextjs-observe/packages/next-observe && npm test && npm run build && npm pack
cd vercel-otel-test && npm i ../nextjs-observe/packages/next-observe/next-observe-0.0.1.tgz
node observe-poc/collector.mjs &          # коллектор
npx next dev                               # или: npx next build --profile && npx next start
# открыть /observe, кликнуть счётчик 2 раза, нажать "server action"
node observe-poc/verify.mjs
```

### Результат

| Проверка | dev | prod (`--profile`) |
|---|---|---|
| `render ObservePage` под `render route (app) /observe` | ✅ | ✅ |
| `loadData` — дочерний к `render ObservePage`, ~30ms | ✅ | ✅ |
| `increment` внутри `POST /observe`, один трейс с браузерным `fetch` | ✅ | ✅ |
| `react.renders`, `Counter.count` | 6 | **3** |
| `displayName` Counter / Badge в бандле | — | ✅ |
| `actualDuration` в бандле | — | 21 |

### Что узнали

- `Counter.count = 6` в dev и `3` в проде: StrictMode в dev рендерит дважды. **Счётчики рендеров в dev завышены вдвое.** Их надо либо помечать в UI, либо делить на 2.
- В Babel 8 есть собственные TS-типы (`PluginAPI`, `PluginObject`, `NodePath`). `ExportSpecifier.local` может быть `StringLiteral`, а не только `Identifier`.
- `import()` в `.cts` при `module: NodeNext` остаётся `import()`, а не превращается в `require()`. Поэтому CommonJS-loader может грузить ESM-трансформ.
- Инструкция «Как повторить» из шага 3 устарела: `next.config` в `vercel-otel-test` теперь использует пакет. Файлы POC-loader в `observe-poc/` оставлены для истории, от POC используются только `collector.mjs` и `verify.mjs`.

---

## Шаг 6. `next-observe/server` и `next-observe/client`

**Чтобы** подключение сервера и браузера тоже было в одну строку, а адрес коллектора брался из env,
**делаем** две точки входа в пакете.

```ts
// instrumentation.ts
export { register } from 'next-observe/server'
```
```ts
// instrumentation-client.ts
import 'next-observe/client'
```

**`next-observe/server`** — обёртка над `@vercel/otel`:
- экспорт в OTLP/JSON на `${OBSERVE_ENDPOINT}/v1/traces` (по умолчанию `http://localhost:4318`);
- заголовок `x-api-key` из `OBSERVE_API_KEY`;
- `service.name` из `OBSERVE_SERVICE_NAME`;
- `service.version` из `OBSERVE_SERVICE_VERSION` или `VERCEL_GIT_COMMIT_SHA`. Это нужно агенту для вопроса «какой деплой всё сломал»;
- для своих настроек: `export const register = () => registerObserve({ ... })`.

**`next-observe/client`** — браузерный OTel из POC:
- `WebTracerProvider` + `DocumentLoad` + `Fetch`, `BatchSpanProcessor` (раз в 2s и при скрытии страницы);
- `service.name` = `<имя>-browser`;
- экспорт на **свой же домен** `/__observe/v1/traces`.

**`withObserve()` теперь дополнительно:**
- добавляет rewrite `/__observe/:path*` → `${OBSERVE_ENDPOINT}/:path*` в `beforeFiles`. Браузер шлёт на свой origin, Next проксирует в коллектор: **нет CORS и не нужна публичная переменная с адресом**. Пользовательские rewrite в любой из трёх форм (нет, массив, объект) сохраняются;
- кладёт `OBSERVE_SERVICE_NAME` в `env` конфига. По умолчанию это `name` из `package.json` проекта. Next подставляет его при сборке и в серверный, и в браузерный код.

Зависимости: `@vercel/otel` и его peer-пакеты (`api-logs`, `sdk-logs`, `sdk-metrics`, `sdk-trace-base`) — в `dependencies` пакета, чтобы pnpm и строгий npm их ставили.

### Как тестировали

1. **Юнит-тесты, 35 штук** (было 23):
   - `server`: что уходит в `registerOTel` и в экспортёр без конфига, из env, при приоритете опций над env и `OBSERVE_SERVICE_VERSION` над SHA от Vercel, при обрезке `/` в конце endpoint;
   - `client`: разрешение опций, импорт на сервере (SSR) не регистрирует провайдер;
   - `withObserve`: имя из `package.json`, приоритеты env и опций, rewrite во всех трёх формах, endpoint без `/` в конце.
2. **Проверка тестов:** сломали обрезку `/` на сервере и положение пользовательских rewrite — упали по одному тесту на каждую поломку.
3. **Сквозной тест** (tarball → `vercel-otel-test`): `verify.mjs` расширен до 13 проверок — `documentLoad` пришёл через прокси, запросы экспортёра не трассируются, `service.version` совпадает с ожидаемым (`EXPECT_VERSION`). Коллектор теперь сохраняет `service.version`.

```bash
OBSERVE_SERVICE_VERSION=v1 npx next dev                          # dev
OBSERVE_SERVICE_VERSION=v2 npx next build --profile && OBSERVE_SERVICE_VERSION=v2 npx next start
EXPECT_VERSION=v1 node observe-poc/verify.mjs                    # или v2 для прода
```

### Результат

| | dev (`v1`) | prod (`--profile`, `v2`) |
|---|---|---|
| все 13 проверок | ✅ | ✅ |
| `service.name` сервер / браузер | `vercel-otel-test` / `vercel-otel-test-browser` | то же |
| `service.version` на серверных спанах | `v1` | `v2` |
| `Counter.count` | 6 (StrictMode) | 3 |

### Что узнали

- **`ignoreUrls` для своих экспортов не нужен.** Проверили: убрали его и получили 0 трассированных запросов экспорта на 41 браузерный спан. OTLP-экспортёр сам отключает трассировку своих `fetch`. Строку удалили, e2e-проверка «нет петли» осталась как защита от регрессии.
- `env` из `next.config` доходит и до `instrumentation.ts`: серверный `register()` получил имя из `package.json`.
- Rewrite вычисляются **при сборке**. В проде `OBSERVE_ENDPOINT` должен быть задан во время `next build`. На Vercel env доступен при сборке, так что это нормально, но в документацию стоит записать.
- **У браузерных спанов пока нет `service.version`.** Добавить через тот же `env` в `withObserve()`.

---

## Шаг 7. Коллектор + хранилище + API запросов в пакете

**Чтобы** у UI и у агентов был один источник данных, а не файл `spans.jsonl`,
**делаем** `next-observe/collector` на встроенных модулях Node, без Fastify и вообще без зависимостей.

```ts
import { startCollector } from 'next-observe/collector'
const collector = await startCollector()          // http://127.0.0.1:4318
```

| Endpoint | Что возвращает |
|---|---|
| `POST /v1/traces` | приём OTLP/JSON; protobuf → `415` с подсказкой «настройте экспортёр на http/json» |
| `GET /health` | `{ status, spans }` |
| `GET /api/services` | сервисы с версиями — для вопроса «какой деплой» |
| `GET /api/traces?service&operation&minDurationMs&hasError&fromMs&toMs&limit` | сводки трейсов: корень, сервисы, длительность, число спанов и ошибок |
| `GET /api/traces/:traceId` | все спаны трейса в порядке waterfall |
| `GET /api/operations?service&operation` | **агрегаты** по операциям: count, errorRate, avg / p50 / p95 / p99 / max — то, что будут получать агенты |

Устройство:
- **`decode.ts`** — OTLP/JSON → `NormalizedSpan`. Id в hex, время в наносекундах через BigInt, все типы атрибутов, события-исключения.
- **`memory-storage.ts`** — `StorageAdapter` в памяти, по умолчанию лимит 100k спанов, старые вытесняются.
- **`server.ts`** — `node:http`: CORS, лимит тела 10 МБ → `413`, `x-api-key` → `401` (если задан `apiKey`), ошибки параметров → `400`.

### Как тестировали

1. **Контрактный тест декодера:** спаны создаёт настоящий OTel SDK, сериализует `JsonTraceSerializer` — тот же код, что в экспортёре. Проверяются id, связи parent/child, resource, kind, статус, все типы атрибутов, исключения, время.
2. **Хранилище:** перцентили сверены с эталонными значениями на 1..100, все фильтры, корень трейса при опоздавшем родителе, группировка операций, версии сервисов, вытеснение.
3. **HTTP:** настоящий `OTLPTraceExporter` шлёт в запущенный коллектор, потом API. Отдельно `415`, `400`, `404`, `413` (ответ доходит до клиента), `401`, CORS preflight.
4. **Сквозной тест:** `vercel-otel-test` → коллектор из пакета. Новый скрипт `packages/next-observe/e2e/observe-page.mjs` проверяет 12 утверждений **через API коллектора**, а не через файл.

```bash
node -e "import('next-observe/collector').then(m => m.startCollector())" &
OBSERVE_SERVICE_VERSION=v1 npx next dev          # сценарий /observe: 2 клика + server action
EXPECT_VERSION=v1 node ../nextjs-observe/packages/next-observe/e2e/observe-page.mjs
```

**Юнит-тесты: 59** (было 35). **E2E: 12 из 12** в dev (`v1`) и в prod `--profile` (`v2`).

### Что узнали (тесты поймали два настоящих бага)

- **Точность длительности.** Сначала `durationMs` считался как разность двух эпохальных миллисекунд (~1.8e12). У float64 на таком масштабе ошибка ~0.6 мкс. Исправили: вычитаем в наносекундах через BigInt, потом переводим. Поймал контрактный тест.
- **Порядок waterfall.** Родитель и потомок часто стартуют в одну миллисекунду, а экспортёр присылает потомка первым (он раньше закончился). Сортировка только по времени ставила потомка выше родителя. Исправили вторым ключом — глубиной в дереве. Поймал HTTP-тест с настоящим экспортёром, добавлен детерминированный юнит-тест, мутационная проверка его подтвердила.
- **`localhost` vs `127.0.0.1`.** Node может разрешить `localhost` в IPv6 `::1`, а коллектор слушает IPv4. Endpoint по умолчанию теперь `http://127.0.0.1:4318`.
- Для трейса server action корень — **браузерный** `POST`. Серверный `POST /observe` — его потомок. UI и агенты должны это учитывать: «корневой сервис» трейса может быть браузером.

### Git

`master` в GitHub отставал: PR #1 смержился в ветку хука (она стала веткой по умолчанию). Шаг 7 построен поверх коммита с шагом 6. **Нужно:** сделать `master` веткой по умолчанию и влить в него ветку хука.

---

## Шаг 8. CLI: `nxo dev` и `nxo collector`

**Чтобы** участник запускал всё одной командой из корня проекта (или с `--root`), а на сервере коллектор настраивался через env,
**делаем** CLI. У пакета два имени команды: `next-observe` и короткое `nxo`.

```bash
nxo dev                                   # из корня Next-проекта
nxo dev --root apps/web -- -p 3100        # из другой папки; всё после -- уходит в next dev
nxo collector --host 0.0.0.0 --api-key …  # только коллектор (сервер, дроплет)
```

- **`nxo dev`**
  1. проверяет, что в `--root` есть `package.json` и установлен `next`;
  2. поднимает коллектор;
  3. запускает `next dev` из `node_modules` проекта с `OBSERVE_ENDPOINT`, указывающим на этот коллектор. `register()` и браузерный прокси `/__observe` сами попадают в правильное место;
  4. Ctrl+C гасит `next dev` и коллектор. Если `next dev` упал, CLI выходит с его кодом.
- **`nxo collector`** — только коллектор. Всё настраивается через env: `OBSERVE_PORT`, `OBSERVE_HOST`, `OBSERVE_API_KEY`. `OBSERVE_ROOT` задаёт корень для `dev`. Флаги важнее env.
- **Понятные ошибки:** неизвестная команда, неверный порт, нет `package.json`, не установлен `next`, «порт 4318 занят — уже запущен другой nxo? используйте --port».

Устройство: вся логика в `cli.ts` — функция `run(argv, deps)`, куда подставляются `spawn`, env и сигнал остановки. `bin.ts` — пять строк, которые связывают её с настоящим процессом. Так CLI тестируется в том же процессе, без запуска `next`.

### Как тестировали

1. **Юнит-тесты: 70** (было 59). 11 на CLI: разбор аргументов (`--root` относительно cwd, `--root=…`, аргументы после `--`, env и приоритет флагов, ошибки), help, занятый порт. `collector`: работает до сигнала, требует ключ из env, после остановки порт закрыт. `dev`: фейковый `spawn`, но **настоящий** коллектор — проверяются путь к бинарнику `next` из проекта, `cwd`, `stdio`, что `OBSERVE_ENDPOINT` перекрывает внешний, что коллектор доступен, пока идёт `next dev`, что код выхода передаётся, что Ctrl+C убивает `next dev` и закрывает коллектор, что при ошибке ничего не запускается.
2. **Мутации:** не передавать `OBSERVE_ENDPOINT` — упал 1 тест; игнорировать `--root` — упали 4.
3. **Сквозной тест** на установленном из tarball пакете, запуск **из родительской папки**:

```bash
OBSERVE_SERVICE_VERSION=v1 vercel-otel-test/node_modules/.bin/nxo dev --root vercel-otel-test -- -p 3100
# сценарий /observe: 2 клика + server action
EXPECT_VERSION=v1 node nextjs-observe/packages/next-observe/e2e/observe-page.mjs     # 12/12
kill -INT <pid nxo>                                                                  # как Ctrl+C
```

После `SIGINT`: процессы `nxo` и `next dev` завершились, порты 3100 и 4318 свободны.

### Что узнали

- На macOS `tmpdir()` — симлинк `/var` → `/private/var`. `require.resolve` возвращает реальный путь, поэтому тесты сравнивают с `realpathSync`.
- Типы Next делают `process.env.NODE_ENV` обязательным в `NodeJS.ProcessEnv`, и это касается всех, кто подключает типы `next`. Для CLI у нас свой тип `Env = Record<string, string | undefined>`.
- Шебанг `#!/usr/bin/env node` TypeScript переносит в `dist/bin.js` как есть, а npm при установке делает bin исполняемым. Ничего дописывать не пришлось.

---

## Шаг 9. UI: список трейсов и waterfall

**Чтобы** после `nxo dev` было что открыть в браузере,
**делаем** React-SPA, которую раздаёт сам коллектор.

**Решение: SPA на Vite, а не Next внутри пакета.** Next-приложение из `node_modules` — это второй сервер и порт, десятки МБ в пакете и возможный конфликт версий с Next участника. При этом серверный Next здесь не нужен: данные и агенты живут в процессе коллектора. Dogfooding Next остаётся за shop app.

**Стек:** React 19, Vite 8, **TanStack Router** (фильтры в URL как типизированные search params) + **TanStack Query** (опрос API раз в 2s), **shadcn/ui + Tailwind 4** для быстрого прототипирования. TanStack Table и Form пока не нужны.

```
packages/next-observe/
  ui/                      отдельный Vite-проект (свой package.json, в npm не публикуется)
    src/api.ts             типы — import type прямо из src/collector/types.ts
    src/router.tsx         /  →  /traces?service&operation&minDurationMs&hasError,  /traces/$traceId
    src/pages/…            список трейсов, waterfall + панель атрибутов
    src/lib/waterfall.ts   чистая раскладка: глубина, смещение и ширина полос в %
  src/collector/static.ts  раздача dist/ui + SPA-fallback
```

- `npm run build` в пакете = `tsc` + `vite build` → `dist/ui`. В npm уходит только статика.
- Коллектор отдаёт UI на `/`. Любой неизвестный путь получает `index.html` (прямые ссылки `/traces/<id>` работают), `assets/*` кэшируются как immutable. `/api/*` и `/v1/*` никогда не уходят в fallback и отвечают JSON 404.
- Баннер `nxo` теперь показывает строку `ui  http://127.0.0.1:4318`.
- Разработка самого UI: `npm run ui:dev` — Vite с прокси `/api` на запущенный коллектор.

shadcn в неинтерактивном режиме: `npx shadcn@latest init -t vite -b radix -p nova --no-monorepo -y`. Без `-p` он задаёт вопрос, а `-d` включает шаблон Next. Утилита `cn` теперь отдельный пакет `cn` от команды shadcn (замена clsx + tailwind-merge).

### Как тестировали

1. **Юнит-тесты: 82** (было 70):
   - раскладка waterfall: порядок обхода в глубину, уровни вложенности, полосы в %, минимальная ширина, «сироты» становятся корнями;
   - формат длительности;
   - раздача UI: index без долгого кэша, SPA-fallback, типы и кэш ассетов, `/api` и `/v1` в JSON, отсутствие сборки → 404;
   - **выход за папку**: `..%2f..%2fsecret.txt`;
   - `register()` игнорирует `fetch` на коллектор.
2. **Мутации:** без проверки пути запрос `..%2f` **отдаёт файл за пределами UI** — тест ловит. Без исключения `/api/` из fallback — тоже ловит.
3. **Сквозной тест:** `nxo dev` → сценарий `/observe` → API-скрипт 12/12 → UI в Playwright:
   - `/` редиректит на `/traces`, в списке нужные трейсы;
   - `?operation=render%20ObservePage` оставляет ровно `GET /observe`, значение подставляется в поле;
   - в waterfall `render ObservePage` на уровне 3, `loadData` сразу под ним на уровне 4, в деталях `vercel-otel-test@v1` и `code.filepath`;
   - прямая загрузка `/traces/<id>` работает.

### Что узнали

- **Шум от прокси.** В UI сразу стали видны корневые спаны `http POST http://127.0.0.1:4318/v1/traces`. Это `@vercel/otel/fetch` трассировал, как Next пересылает браузерные батчи через `/__observe`: один шумный трейс на батч. Не вечная петля (без браузера число не растёт), но мусор. Исправление: `instrumentationConfig.fetch.ignoreUrls: ['<endpoint>/']` в `register()` (строки сравниваются через `startsWith`). После исправления таких спанов 0.
- В dev виден ещё и `fetch GET registry.npmjs.org/-/package/next/dist-tags` — Next проверяет свою версию. Это поведение Next, только в dev. Позже можно прятать в UI.
- **Визуальный баг, найденный по скриншоту:** подпись длительности лежала поверх полосы и не читалась. Вынесли её в отдельную колонку.
- **Скрипт `typecheck` натворил дел:** `npm --prefix ui exec tsc -b` запускает `tsc` не в `ui/`, а в текущей папке. Корневой tsconfig без `outDir` выложил `.js` рядом с исходниками, и vitest нашёл тесты дважды (162 вместо 81). Правильно — `npm --prefix ui run typecheck`: `run` выполняется в папке пакета.
- **Зависание `nxo` при остановке — причина не найдена.** Один раз после `SIGINT` `next dev` завершился и порты освободились, но процесс `nxo` висел, а второй `SIGINT` и `SIGTERM` его не убили. Проверили три гипотезы: открытая вкладка UI с keep-alive, preconnect-сокет без запроса, переустановка пакета на живом процессе. Ни одна не воспроизвелась: в Node 24 `server.close()` сам закрывает такие сокеты. Что сделали:
  - **второй Ctrl+C завершает процесс немедленно** (`exit 130`). Раньше `bin.ts` перехватывал и второй сигнал и ничего не делал — это настоящий баг;
  - `closeAllConnections()` при закрытии коллектора — как защитная мера, с честным комментарием;
  - тест на «сокет без запроса» удалили: он проходил и без исправления, то есть ничего не охранял.

---

## Шаг 10. Проверка: ADK 2.x + Kitana (Claude CLI)

**Чтобы** до постройки чата убедиться, что стек агентов вообще работает,
**делаем** две изолированные проверки в `spikes/adk-kitana/`. Модель — `KitanaLlm` с цепочкой только из `claude`, то есть подписка Claude через CLI, без API-ключей.

```bash
cd spikes/adk-kitana && npm install
npm run agent          # один агент + один инструмент
npm run orchestrator   # оркестратор + два агента-специалиста как инструменты (AgentTool)
```

Версии: `@google/adk` 2.1.0, `@kitana-sdk/adk` 0.1.7, `@google/genai` 2.24.0. Установка прошла без конфликтов peer-зависимостей, 197 пакетов.

API ADK JS 2.x, который нам нужен:

```ts
const tool = new FunctionTool({ name, description, parameters: z.object({…}), execute: async (args) => data })
const agent = new LlmAgent({ name, description, model: new KitanaLlm({ model: 'auto', chain: ['claude'] }), instruction, tools: [tool] })
const orchestrator = new LlmAgent({ …, tools: [new AgentTool({ agent }), …] })          // агент как инструмент
for await (const event of new InMemoryRunner({ agent: orchestrator }).runEphemeral({ userId, newMessage })) { … }
```

Данные синтетические, в форме наших `/api/operations`: `chargePayment` p99 310 → 2490 мс между `v1` и `v2`, `inventory.check` 30% ошибок `Inventory service timeout: upstream not responding`. Скрипты сами проверяют ответ: вызван ли инструмент, названы ли `chargePayment`, `v2`, точные цифры, исключение, язык ответа.

### Результаты

| Прогон | Результат | Время |
|---|---|---|
| Агент, инструмент v1 | ❌ агент искал `checkout`, получил пустой ответ и сдался | 10s |
| Агент, инструмент v2 (при пустом совпадении отдаёт всё) | ✅ 2 из 2: сам сопоставил checkout → `chargePayment`, назвал `v2`, точные p50/p95/p99 | 10–11s |
| Оркестратор | ❌ 1 из 3: специалист по латентности не вызвал свой инструмент, оркестратор **выдумал** связь | 43s |
| Оркестратор | ✅ 2 из 3: оба специалиста, обе проблемы названы как **независимые**, точные цифры и исключение | 35–37s |

**Вывод:** интеграция работает (ADK 2.1 → Kitana → Claude CLI → инструменты → ответ). Нестабильность — в поведении модели, а не в связке. Кейсы для воркшопа — в `WORKSHOP_PLAN.md` → «Кейсы для блока агентов».

### Что узнали

- **Проектирование инструментов важнее промпта.** Пользователь говорит «checkout», спаны называются `chargePayment`. Пустой результат фильтра ведёт к тому, что агент сдаётся. Исправили в инструменте, а не в инструкции: при пустом совпадении инструмент возвращает все операции с пометкой `note`.
- **Оркестратор галлюцинирует на неполных данных.** Когда специалист не отработал, оркестратор написал уверенный отчёт «checkout медленный из-за того же inventory» — в данных этого нет. Нужны правила «только факты из инструментов» и проверка ответа (evals).
- ~~**Личная конфигурация Claude Code участника влияет на агента.**~~ **Поправка (шаг 12):** причина русского ответа — не личные настройки `claude` CLI, а промпт самого `@kitana-sdk/adk`: инструменты и историю вызовов он описывает модели по-русски («Доступные инструменты…», «Вызов инструмента…»). Нашли, читая код адаптера. Лечится английским промптом в Kitana; до этого — `Answer in English` в инструкции.
- **Время:** один агент ~10s, оркестратор с двумя специалистами ~35–45s. Каждый агент — отдельный вызов CLI. Для чата нужен индикатор «агент работает» и стриминг промежуточных шагов (какой специалист что вызвал).
- `@google/adk` 2.1.0 фиксирует `@opentelemetry/api` на `1.9.0`, у нас `^1.9.1`. Агенты будут жить в процессе коллектора (`nxo`), где OTel API не используется, а не в Next-приложении. Конфликта там нет.
- ADK тянет тяжёлые зависимости (mikro-orm, google-cloud, vertexai). Для `next-observe` это должна быть **опциональная peer-зависимость** только для `next-observe/debug`.

---

## Шаг 11. Инструменты агентов поверх хранилища

**Чтобы** агенты отвечали по настоящим данным, а не по синтетике из шага 10,
**делаем** `next-observe/debug`: шесть инструментов как **чистые функции над `StorageAdapter`**. ADK здесь не импортируется: инструменты тестируются без модели, а обёртка в `FunctionTool` на следующем шаге займёт одну строку.

```ts
import { createAgentQueries } from 'next-observe/debug'
const q = createAgentQueries(collector.storage)
await q.compareVersions()   // → { changes: [{ operation: 'chargePayment', from: { version: 'v1', p95Ms: 300 }, to: { version: 'v2', p95Ms: 2490 }, p95Ratio: 8.3 }] }
```

| Инструмент | Возвращает | Вопрос |
|---|---|---|
| `getServices` | сервисы, версии **в порядке деплоя**, давность последнего спана | есть ли трафик |
| `getOperationStats` | топ операций по p95 + error rate | что медленное |
| `compareVersions` | **последняя версия против предыдущей** по каждой операции, по убыванию роста p95 | какой деплой всё сломал |
| `getErrors` | падающие операции, доля ошибок, топ-3 сообщения исключений, примеры traceId | почему падает |
| `searchTraces` | короткий список трейсов | покажи примеры |
| `getTrace` | дерево: глубина, длительность, **self time**, ошибка, `code.filepath`; `repeated` — ≥3 одинаковых вызова у одного родителя (**сигнатура N+1**) | первопричина |

Правила для всех инструментов (из кейсов шага 10):
- **компактно**: агрегаты, а не сырые спаны; округлённые числа; только ключевые атрибуты;
- **никогда не пустой ответ по фильтру имени**: если ничего не совпало, возвращается всё с `note: "nothing matches …"`;
- **поиск по имени без учёта регистра**, в том числе в хранилище и UI: `payment` находит `chargePayment`;
- окно по времени `sinceMinutes` (по умолчанию 15).

В хранилище добавлено: `getOperationStats({ byVersion: true })` и `querySpans(filter)`.

### Как тестировали

1. **Детерминированный набор «магазин»** (`test/fixtures/shop.ts`) — сценарий воркшопа:
   - деплои `v0` → `v1` → `v2`, в `v2` `chargePayment` медленнее в ~8 раз;
   - `inventory.check` падает в 30% случаев с `Inventory service timeout: upstream not responding`;
   - в каталоге N+1: 5 × `db.query`;
   - старые данные за пределами окна.
2. **14 тестов на инструменты** (всего 96): каждый инструмент на этом наборе; порядок деплоя **не алфавитный** (`f00d` → `a1b2`); регистр; fallback; пустое окно; N+1 и self time; сообщение об ошибке и `code.filepath`; **бюджет токенов** — каждый ответ меньше 4000 символов.
3. **Мутации:** без fallback, алфавитный порядок версий, порог N+1 = 6, поиск с учётом регистра — каждая мутация роняет свой тест. Одна мутация сначала «прошла», потому что `sed` не нашёл строку. Повторили через Python с проверкой, что замена произошла, и тогда упали два теста. Мораль: мутационную проверку тоже нужно проверять.
4. **Настоящие данные:** `e2e/agent-tools.mjs` поднимает коллектор, ждёт, пока спаны перестанут приходить, и печатает ответы всех инструментов после сценария `/observe`. `getTrace` для `GET /observe`: `loadData` `selfMs 30.5` из 30.8 мс страницы, `code.filepath: app/observe/lib.ts` — прямой указатель на первопричину. Все ответы меньше 2 КБ.

### Что поймало AI-ревью в git-хуке (коммит был заблокирован)

- **Ложный fallback в `getErrors`.** Fallback срабатывал, когда по фильтру не было **ошибок**, а не когда не было **операции**. Вопрос «ошибки `chargePayment`» (операция здоровая) получал ответ «такой операции нет, вот чужие ошибки» — агент ушёл бы не туда. Исправили: fallback только если имя не совпало ни с одной операцией, иначе `note: '"chargePayment" has no errors in this window'`. Добавили 2 теста, мутация их роняет.
- **`rows: object[]` в `getTrace`** стирал форму строки, в тестах были приведения типов. Добавили экспортируемый тип `TraceRow`.
- Для воркшопа: ревью увидело то, что пропустили 96 тестов, потому что тестов на этот случай не было. Fallback — хорошая идея, но у него есть граница применимости.

**Итого тестов: 98.**

### Что узнали на настоящих данных (задачи на потом)

- **Шум Next в dev:** `fetch GET https://registry.npmjs.org/-/package/next/dist-tags` оказался второй по медленности операцией. Агент может отвлечься на него.
- **Холодная компиляция в dev:** первый `GET /observe` занял 1654 мс, это компиляция, а не приложение. Агенту нужно это знать, иначе он «найдёт проблему».
- **Маленькие выборки:** у операций с `count` 1–2 перцентили бессмысленны. Нужен флаг `lowSample` в ответе.
- **Безымянный корень браузерного трейса:** `POST` без URL. Стоит обогащать имя из `http.url`.

---

## Шаг 12. Агенты ADK поверх инструментов: `next-observe/agents`

**Чтобы** на вопрос отвечали агенты с настоящими данными, а отлаживать весь конвейер можно было без токенов,
**делаем** оркестратор и трёх специалистов поверх инструментов шага 11 и выбор модели через env.

```ts
import { createInvestigator, getModel } from 'next-observe/agents'
const investigator = createInvestigator({ storage, model: await getModel(), onStep: (s) => console.log(s) })
const { text, steps, transcript } = await investigator.ask("Checkout is slow. Which deployment caused it?")
```

- **`OBSERVE_AI=mock`** (по умолчанию) → `MockLlm`: детерминированная заглушка без сети. За каждый ход вызывает следующий ещё не вызванный инструмент: пустые аргументы или `{ request: вопрос }` для агента-как-инструмента. Инструменты с другими обязательными аргументами (`traceId`) пропускает, а в конце отдаёт `[mock]`-сводку результатов. Прогоняет весь путь оркестратор → специалисты → инструменты.
- **`OBSERVE_AI=real`** → при `GEMINI_API_KEY` модель из `GEMINI_MODEL` (без хардкода, ADK сам читает ключ), иначе `KitanaLlm`.
- **Агенты:** `orchestrator` → `latency_agent` (stats, compare_versions, search, get_trace), `error_agent` (errors, search, get_trace), `traffic_agent` (services, stats). Общее правило в инструкциях: «только факты из инструментов, точные числа, не угадывать причины, по-английски». У оркестратора дополнительно «разные находки — разные проблемы, пока инструмент не показал связь» (урок кейса 2).
- **`ask()` возвращает** `text`, `steps` (каждый вызов с указанием, какой агент его сделал, дублируется в `onStep`) и `transcript` (вызовы специалистов и их ответы). Это заготовка для промежуточных шагов в чате.
- `@google/adk` и `@kitana-sdk/adk` — **опциональные** peer-зависимости, нужны только для `next-observe/agents`. `next-observe/debug` (инструменты) их не импортирует. `zod` — обычная зависимость.

### Как тестировали

1. **Mock-тесты, 11 штук** (всего 109): выбор модели (mock по умолчанию, ошибка на неизвестный режим, Gemini без `GEMINI_MODEL` → понятная ошибка, иначе `KitanaLlm`); `MockLlm` напрямую (пустые аргументы, `request`, **пропуск инструмента с `traceId`**, без повторов, итоговая сводка); полный прогон оркестратора на наборе «магазин»: вызваны все три специалиста и их инструменты, у каждого шага правильный агент, `onStep` получает те же шаги.
2. **Мутации:** атрибуция шагов (всё помечено одним агентом) → тест падает. Правило пропуска в заглушке → сначала **не поймали**. ADK проверяет аргументы zod-схемой *до* `execute`, поэтому шаг не записывался, а ошибка `Error in tool 'get_trace'` уходила специалисту и терялась в обрезанной сводке. Добавили прямые тесты `MockLlm`, после этого мутация ловится.
3. **Настоящая модель** — `e2e/investigate.real.test.ts`, запускается только при `OBSERVE_AI=real`. Три сценария воркшопа, проверки по фактам:

| Сценарий | Результат |
|---|---|
| 1. «Checkout is slow… which deployment?» → `chargePayment`, `v2` | ✅ 1/1 |
| 2. «500 errors on product pages» → `inventory.check`, 30%, `upstream not responding` | ✅ 1/1 |
| 3. «Catalog slower, no single span stands out» → N+1, 5 × `db.query` | 4/5 ✅ (~33–52s) |

Удачный протокол сценария 3: `latency_agent` → `get_operation_stats` → `compare_versions` → `search_traces` → **`get_trace`** → «N+1 confirmed: 5 identical `db.query` calls (`SELECT * FROM products WHERE id = ?`) after `getProductIds`, 90ms of the 120ms trace — should be batched».

### Что узнали

- **Неудачный прогон сценария 3** провалился двумя способами сразу:
  - специалист не открыл ни одного трейса (`get_trace`), поэтому не увидел `repeated`;
  - «ответ» оркестратора оказался сырым JSON `{"tool_call":{"name":"traffic_agent",…}}`.

  Офлайн `parseToolCall` из Kitana разбирает этот текст корректно, даже с прозой вокруг и в markdown. **Гипотеза:** вызов сгенерировал сам `latency_agent`, пытаясь делегировать работу `traffic_agent`, которого у него нет. Парсер законно отбросил вызов, и JSON стал «ответом» специалиста. Тогда тот прогон шёл без протокола, а в следующих 4 прогонах сбой не повторился, поэтому гипотеза **не подтверждена**. Протокол теперь пишется всегда.
- **Кейс 3 шага 10 объяснён заново:** русский ответ давал не личный конфиг `claude`, а промпт самого `@kitana-sdk/adk`. Описание инструментов и пересказ вызовов в нём на русском («Доступные инструменты…», «Вызов инструмента…»). Поправка внесена в шаг 10 и в план. **Предложение для Kitana:** перевести этот промпт на английский.
- Протокол Kitana — **один вызов инструмента за ход**. У ADK с Gemini вызовы могут идти параллельно, поэтому число ходов и время будут отличаться.
- Vitest 5 не печатает `console.log` успешных тестов. Для протоколов нужен `--silent=false`.
- Время: один сценарий через оркестратор ~35–52s.
- **AI-ревью в хуке снова заблокировало коммит, и по делу:** список `steps` был общим на экземпляр и обнулялся в начале каждого `ask()`. Два одновременных вопроса в чате перемешали бы шаги. Исправили: агенты и инструменты собираются заново на каждый `ask()`, у каждого расследования свой список. Тест «два параллельных вопроса» проверили на воспроизведённом старом поведении: он падает. После рефакторинга сценарий 1 с настоящей моделью снова прошёл (43s). Всего тестов 110.

---

## Шаг 13. Чат: вопрос → шаги агентов вживую → отчёт

**Чтобы** агентов можно было спросить из UI и видеть, что они делают, пока думают (ответ идёт 35–90s),
**делаем** `/api/chat` в коллекторе и страницу `/chat`.

**Транспорт — поток NDJSON на `POST /api/chat`**, по одному событию на строку:

```
{"type":"status","mode":"real","text":"Investigating…"}
{"type":"step","agent":"orchestrator","tool":"latency_agent","args":{"request":"…"}}
{"type":"step","agent":"latency_agent","tool":"compare_versions","args":{…}}
{"type":"report","text":"…"}          ← или {"type":"error","message":"…"}
```

Для интерактивного вопроса это проще SSE: не нужны сессии и склейка POST с отдельной подпиской. SSE понадобится для проактивных сообщений детектора. `GET /api/chat` отдаёт `{ enabled, mode }`.

**Как всё связано:**
- Коллектор **не импортирует ADK**. Он принимает обработчик `chat: { mode, handle }` извне (`ChatHandler` в `collector/chat.ts`).
- `nxo` создаёт хранилище и **лениво** импортирует `next-observe/agents`. Если `@google/adk` не установлен, коллектор работает, а чат выключен: баннер пишет `chat disabled — npm i -D @google/adk @kitana-sdk/adk @google/genai`, UI показывает то же. Неверный `OBSERVE_AI` или `real` без Gemini и без Kitana — понятная ошибка при старте.
- `createChatHandler()`: `status` → `step…` → `report` | `error`. **Таймаут 180s** превращается в `error`. Расследование после таймаута доживает в фоне, но его поздние шаги в закрытый ответ **не попадают**.
- `ask(question, { onStep })` — колбэк на вызов, чтобы два чата не получали чужие шаги.
- UI `/chat`: бейдж `MOCK — no real model` / `REAL model`, три кнопки с вопросами из сценариев воркшопа, шаги (специалисты с отступом) с «working…», отчёт или ошибка.

### Как тестировали

1. **Юнит-тесты: 121** (было 110):
   - транспорт: выключен → `GET` с причиной и `503`; включён → режим, NDJSON по порядку, вопрос обрезается; **события уходят по ходу работы** — обработчик стоит на паузе, а клиент уже читает первое событие; падение обработчика → `error`; `400` на плохой ввод;
   - обработчик: порядок и один `report`; таймаут без утечки поздних шагов (медленная заглушка); падающая модель → `error`;
   - CLI: `chat mock` с настоящим загрузчиком, `chat disabled` при отсутствующем ADK (коллектор жив), ошибки конфигурации.
2. **Мутации:** буферизация до конца, отсутствие защиты от поздних шагов, «нет ADK» = падение CLI — каждая роняет свой тест.
3. **Сквозной тест в три этапа, как у пользователя:**
   1. `vercel-otel-test` **без** ADK → баннер `chat disabled — npm i -D …`, `/chat` показывает подсказку;
   2. та самая команда `npm i -D @google/adk @kitana-sdk/adk @google/genai` → `chat mock`: бейдж MOCK, 10 шагов оркестратора и трёх специалистов, `[mock]`-отчёт на данных приложения;
   3. `OBSERVE_AI=real` → через 15s видны 2 шага и «working…», кнопка «Investigating…» — **шаги идут вживую**. Отчёт пришёл через ~90s.

### Что узнали

- **Правило «только факты» работает.** На вопрос «почему `/observe` медленная» агент ответил: «замедления не обнаружено: `GET /observe` 78.5 мс, `ObservePage` 32.8 мс; данных мало, по одному примеру». Ложную предпосылку опроверг, ничего не выдумал.
- **Но на «где именно тратится время» не ответил:** трейс не открыл, `loadData` (30 из 32 мс) не назвал. Это кейс 4: агрегаты не показывают структуру. Для вопросов «где время» специалисту нужно явно предписать `get_trace`.
- **~90s на ответ** — долго для зала. Каждый специалист — отдельный вызов CLI через Kitana. Варианты: Gemini API (быстрее, параллельные вызовы), меньше специалистов на простой вопрос, `replay` для демо.
- **Markdown в отчёте** (`**…**`, обратные кавычки) показывается сырым. Закроют карточки: Report Agent со структурированным выводом.

---

## Шаг 14. Карточки-доказательства в чате

**Чтобы** вместо стены текста чат показывал факты, на которые можно кликнуть,
**делаем** карточки. **Решение (отличается от исходного плана):** карточки строит **код из результатов инструментов данных**, а не Report Agent вызовами `showAnomalyCard(...)`.

Почему так:
- в карточке не может быть выдумки (кейс 2);
- у Kitana один вызов инструмента за ход: четыре карточки — это +4 хода по 5–10 секунд к и без того 35–90 секундам;
- работает в `mock`: заглушка не умеет заполнять обязательные поля;
- урок для зала: **модель рассуждает — код показывает доказательства.**

| Результат инструмента | Карточка | Порог |
|---|---|---|
| `compare_versions` | **Регрессия**: версия было → стало, полосы p50/p95, «p95 ×8.3» | p95 ≥ 1.5× или ошибки +10 п.п. |
| `get_errors` | **Ошибки**: доля, точный текст исключения, 3 ссылки на трейсы | доля ≥ 5% |
| `get_trace` → `repeated` | **N+1**: «5 × db.query, 90ms» | ≥ 3 одинаковых вызова |
| `get_trace` | **Горячая точка**: спан и файл кода | собственное время ≥ 50% трейса + есть `code.filepath` |
| `get_services` | **Нет трафика** | последний спан > 120s назад |
| `search_traces` | **Список трейсов** (до 5) со ссылками в waterfall | непустой |

Устройство:
- `ask(question, { onStep, onResult })` — `onResult` вызывается после каждого инструмента данных с его результатом;
- `cardsFromResult(tool, args, result)` — чистая функция с порогами `THRESHOLDS`;
- дедупликация по `cardKey`: одну находку от двух агентов показываем один раз;
- событие `{ type: 'card', card }` уходит **сразу** после инструмента, до отчёта модели;
- UI: компоненты карточек на shadcn, ссылки ведут в waterfall; в тексте отчёта рендерятся `**жирный**` и `` `код` `` (React-элементы, не HTML — инъекция невозможна);
- в инструкции латентного агента: «на вопрос "где время" всегда открывай трейс».

**`nxo collector --demo`** засевает хранилище сценарием «магазин» (время относительно «сейчас»). Им можно показать чат и карточки без приложения — для репетиций и запасного демо. Сценарий переехал из тестов в пакет (`demoSpans(now)`, `seedDemo(storage)`), тесты вызывают его с фиксированным временем.

### Как тестировали

1. **Юнит-тесты: 129** (было 121):
   - карточки для каждого инструмента на данных «магазина»: регрессия `chargePayment` v1 → v2 ×8+, отсечение ниже порога; ошибки `inventory.check` 30% с точным сообщением, отсечение 1%; N+1 для каталога; горячая точка `lib/payment.ts` для медленного checkout; «нет трафика» только через 10 минут тишины; список трейсов с подписью по фильтрам;
   - обработчик в `mock`: карточки регрессии, ошибок и трейсов, без дублей, до отчёта;
   - `--demo` в CLI.
2. **Мутации:** без порога регрессии, без дедупликации, «горячая точка» никогда не срабатывает — каждая роняет свой тест.
3. **Настоящие данные «магазина» тоже поймали особенность:** последние спаны были 126s назад, это больше порога 120s, и сервис честно выглядел **молчащим**. Сдвинули окно `v2` на «5–1 минут назад».
4. **Сквозной тест** (`nxo collector --demo`):
   - `mock`: 5 карточек — регрессия `chargePayment` ×8.3 и `POST /api/checkout` ×7.8, ошибки `inventory.check` и маршрута 30%, список трейсов; 11 ссылок, клик открывает waterfall падающего запроса;
   - **настоящая модель**, сценарий 3: `search_traces` → карточка списка появилась **сразу, до отчёта**; `get_trace` → карточка **«N+1 · 5 × db.query 90ms»**; отчёт: «death by many small queries rather than one slow one» — верно, `**`/`` ` `` отрисованы.

### Что узнали

- Инструкция «открой трейс» сработала: в сценарии 3 агент дошёл до `get_trace`, и карточка N+1 появилась сама.
- **Демо-данные стареют:** через ~2 минуты после старта `--demo` сервис станет «молчащим», и карточка «нет трафика» будет правдой. Для долгого демо данные надо подливать.
- **Чат без памяти:** агент закончил встречным вопросом («want me to run that comparison?»), но каждый вопрос — новое расследование. Нужна история диалога.
- Ссылки на трейсы в карточках надо было явно выделить цветом, без этого они не читались как ссылки (нашли по скриншоту).

---

## Шаг 15. Kitana на английском и исправление `get_errors`

**Чтобы** агенты отвечали по-английски без подсказок и не пропускали ошибки на «чужих» операциях,
**делаем** две правки: одну в Kitana, одну у себя.

### Kitana: английский протокол (0.1.8 → 0.1.9 → 0.1.10)

1. **0.1.8 — дословный перевод сломал вызовы инструментов.** «Available tools… To call a tool…» — и `claude -p`, то есть Claude Code **со своими нативными инструментами**, стал искать `latency_agent` своим `ToolSearch`, не нашёл и ответил «tools not available». Специалисты оркестратора: **0 из 3** прогонов вызвали инструменты (на 0.1.7 в тех же условиях 2 из 2). Нашли, логируя сырые ответы модели.
2. **0.1.9 — формулировка «это функции текстового протокола, НЕ твои нативные инструменты, их выполняет вызывающая сторона».** Оркестратор **3 из 3** полностью (лучше 0.1.7), агент 2 из 2, ответы на английском **без** подсказки «Answer in English». Тесты Kitana: в модель не уходит кириллица, промпт содержит «NOT your native tools».
3. **0.1.8 и 0.1.9 в npm оказались неустанавливаемыми:** `"@kitana-sdk/core": "workspace:^0.1.6"`, опубликованы через `npm publish` вместо `pnpm publish`. Любой `npm i @kitana-sdk/adk` падал с `EUNSUPPORTEDPROTOCOL` — в том числе команда из баннера `nxo`. **0.1.10** — тот же код, собранный через `pnpm pack`; проверено обычным `npm install` в пустой проект.

### `get_errors`: здоровая операция скрывала чужие ошибки

- Настоящая модель в сценарии «500 на страницах товара» вызвала `get_errors({ operation: "product" })`. `GET /api/products` здорова → ответ «у "product" нет ошибок» → 30% ошибок `inventory.check` (которые и роняют страницы товара) агент не увидел, итог «всё чисто».
- Исправление шага 11 (не выдавать «операции не существует» для здоровой операции) закрыло одну ловушку и открыло другую. Теперь: `note: '"product" has no errors in this window; showing failing operations elsewhere'` **плюс** реальные ошибки остальных операций.
- Тест на этот случай, мутация («здоровая операция без ошибок других») его роняет. Всего тестов 129.

**Итог после публикации 0.1.10:** в реестре `"@kitana-sdk/core": "^0.1.6"`, `latest` = 0.1.10, `npm install` в пустой проект проходит; 0.1.8 и 0.1.9 помечены deprecated. В `next-observe` Kitana `^0.1.10` (dev) и `>=0.1.10` (peer): 129 юнит-тестов, **3/3 сценария воркшопа** с настоящей моделью на версии из npm.

### Что узнали

- **Промпт адаптера — это код, и его формулировки ломают поведение.** Перевод «слово в слово» изменил смысл для модели, которая сама является агентом.
- **Проверять надо ровно то, что будет опубликовано.** Мои прогоны на tarball из `pnpm pack` прошли, а в реестр ушёл другой артефакт.
- **Fallback-логика инструментов требует сценарных тестов:** каждое исправление граничного случая (шаг 11 → шаг 15) надо прогонять на вопросах пользователя, а не только на юнит-тестах.

---

## Шаг 16. Память диалога через сессии ADK

**Чтобы** на встречный вопрос агента («want me to…?») или уточнение («which version introduced **it**?») можно было ответить,
**делаем** сессии ADK. Никакой своей истории: ADK сам кладёт в сессию вопросы, вызовы специалистов и ответы.

- **Investigator:** один `InMemorySessionService`. `startSession(id?)` продолжает сессию или начинает новую (неизвестный id после перезапуска `nxo` — тоже новая, с тем же id). `ask(question, { sessionId })` идёт через `new Runner({ …, sessionService }).runAsync({ userId, sessionId, newMessage })` вместо `runEphemeral`. Оркестратора по-прежнему собираем на каждый `ask()` — сессия живёт в сервисе, а не в объекте агента.
- **Память только у оркестратора.** Специалисты (`AgentTool`) стартуют с чистого листа и получают контекст через запрос оркестратора — их промпты не растут.
- **Протокол:** `ChatRequest { question, sessionId? }`; событие `status` несёт `sessionId`; коллектор проверяет формат id (`[\w-]{1,100}`). Второй вопрос в ту же сессию, пока идёт первый, получает ошибку «this chat is still answering the previous question», иначе история перемешается.
- **`MockLlm`** смотрит только на текущий ход (после последнего вопроса пользователя). Иначе на втором вопросе заглушка решила бы, что всё уже вызвано.
- **UI:** `sessionId` берётся из первого `status`, кнопка «New chat» начинает новый разговор.
- Сессии в памяти процесса и пропадают при перезапуске. Для воркшопа достаточно (в ADK есть `DatabaseSessionService`).

### Как тестировали

1. **Юнит-тесты: 135 → 137** (было 129):
   - заглушка на втором вопросе снова вызывает инструменты;
   - **шпион-модель**: на втором ходу оркестратор получает первый вопрос, ответ на него и новый вопрос, специалисты снова работают; в новой сессии первого вопроса нет;
   - неизвестный id после перезапуска принимается;
   - занятая сессия отклоняет второй вопрос, после ответа снова свободна;
   - коллектор передаёт `sessionId` и отклоняет `../etc` и числа.
2. **Мутации:** вернуть `runEphemeral`; заглушка по всей истории; без блокировки — каждая роняет свой тест.
3. **Настоящая модель**, `e2e` сценарий 4: «Checkout is slow. What's the slowest operation?» → «Which deployment introduced **it**? p95 before and after?» — **2 из 3**. Второй ход **8s против ~45s** у первого: оркестратор отвечает по памяти, без специалистов. В неудачном прогоне «which deployment» понят как «id/время деплоя», которых в данных нет.
4. **Сквозной тест в браузере** (`nxo collector --demo`, `OBSERVE_AI=real`): первый вопрос → отчёт + карточки регрессии, трейсов и горячей точки; уточнение «Which version introduced it, and what exactly takes the time inside it?» → почти мгновенно «v2… `chargePayment` (`lib/payment.ts`) 2490 из 2510 ms»; в запросе браузера ушёл `sessionId`; «New chat» очистил экран, и следующий запрос ушёл **без** `sessionId`.

### Что узнали

- **Уточнения по памяти — быстрые (секунды), но без карточек:** инструменты не вызываются, поэтому доказательства только в первом ответе. Можно просить оркестратора ссылаться на прошлые карточки или перепроверять данные на вопросы «с цифрами».
- В TypeScript пакета пришлось поднять `target`/`lib` до ES2023 (`findLastIndex`), что согласуется с требованием Node 22+.
- У shadcn `Button` по умолчанию `type="submit"`. Кнопка вне формы безвредна, но явный `type="button"` защищает от случайной отправки, если разметка поменяется.
- **AI-ревью в хуке заблокировало коммит — два настоящих бага в блокировке сессии:**
  1. **Гонка (TOCTOU):** `busy.has()` проверялся синхронно, а `busy.add()` стоял после `await startSession()` — два одновременных запроса в одну сессию проходили оба. Теперь переданный `sessionId` резервируется **до** любого `await`.
  2. **Таймаут снимал блокировку, хотя расследование продолжалось в фоне** и писало в ту же сессию. Теперь после таймаута сессия освобождается, только когда фоновое расследование действительно закончилось.

  Два теста («ровно один из двух одновременных запросов», «после таймаута сессия занята, пока фон не кончится»); мутации, воспроизводящие старый код, роняют каждый. **Тестов 137.** Урок тот же, что в шаге 12: блокировки и таймауты требуют тестов на конкурентность, а не только на счастливый путь.

---

## Шаг 17. Детектор аномалий: чат сообщает о проблеме сам

**Чтобы** в финале демо сказать «смотрите, я ничего не делаю», а приложение само нашло и объяснило проблему,
**делаем** детектор и проактивные расследования.

**`AnomalyDetector`** (`next-observe/debug`) — чистый класс с подставляемыми часами:
- скользящее окно **10s** по времени получения спанов; считаются **только серверные запросы** (`kind = server`). Внутренние спаны Next (~7 на запрос) размыли бы 30% ошибок ниже порога — это исправление к исходному плану;
- правила: доля ошибок **> 20%**; доля медленных (> **1000 ms**) **> 30%**; тишина **> 120s** после того, как трафик был;
- **минимум 5 запросов** в окне — «1 из 1» не 100%; **cooldown 5 минут** на тип;
- аномалия несёт операции-виновники; `questionFor(anomaly)` превращает её в вопрос агентам с этими фактами.

**Коллектор:** при приёме отдаёт спаны детектору, раз в 5s проверяет окно. При аномалии:
- событие `anomaly` уходит всем вкладкам через **SSE `GET /api/chat/events`**;
- если есть агенты — **расследование запускается само** тем же обработчиком чата; его `status/step/card/report` идут в тот же поток с тем же `turnId`;
- расследования **в очереди, по одному**;
- новая вкладка получает недавние проактивные события при подключении; у каждого события `seq`, клиент пропускает повторы после переподключения `EventSource`;
- heartbeat-комментарий раз в 15s держит SSE живым через прокси.

**CLI:** детектор включён по умолчанию (`OBSERVE_DETECTOR=off` выключает), баннер: `detector errors > 20%, slow (>1000ms) > 30%, silence > 120s → agents investigate on their own`. Без ADK аномалии всё равно показываются.

**UI:** подписка на поток; проактивное сообщение — красная плашка аномалии (тяжесть, доля, окно, операции) вместо пузыря вопроса, под ней шаги «agents are investigating on their own…», карточки и отчёт. Ввод блокируют только свои вопросы. Когда проактивное расследование закончилось, **следующий вопрос продолжает его сессию** («is this new?»).

**Генератор трафика** `e2e/traffic.mjs`: `node e2e/traffic.mjs healthy 15 failing 25` — серверные спаны `shop@v2` по фазам (`healthy` / `failing` — 40% `Inventory service timeout` / `slow` — 40% checkout > 2s). Засеянные `--demo` данные детектор не видит — он смотрит только на приём.

### Как тестировали

1. **Юнит-тесты: 152 → 153** (было 137):
   - детектор: здоровый трафик; ошибки с виновником первым; **внутренние спаны не размывают долю**; медленные; минимум выборки; окно забывает старое; cooldown; тишина только после трафика; текст вопроса;
   - проактивный поток через **настоящий SSE**: 40% ошибок → `anomaly` → `status` → `report` с одним `turnId` и `seq` 1, 2, 3; без агентов — только аномалия; поздняя вкладка получает историю; две аномалии разом → расследования **строго по очереди**; здоровый трафик → тишина;
   - CLI: баннер детектора и `OBSERVE_DETECTOR=off`.
2. **Мутации (6):** все спаны вместо серверных, без минимума выборки, без cooldown, без очереди, детектор не получает спаны, без повтора истории — каждая роняет свой тест.
3. **Сквозной тест в браузере** (`nxo collector --demo` + генератор; чат открыт заранее, **ни одного клика**):
   - `mock`: 15s здорово → 0 проактивных сообщений; ~5s после начала ошибок → «High error rate · 30% of 40 requests failed in 10s, `GET /api/inventory/[id]` 12 errors», 10 шагов, карточки, отчёт; одно сообщение за 25s фазы (cooldown);
   - **настоящая модель**: «38% of 40 requests» → оркестратор **сам** → `error_agent` → `get_errors` → `get_trace` → карточка «Failing 51%» → отчёт: точное исключение (44 случая), «сбой внутри самого обработчика, дочерних вызовов нет» — верно для генератора;
   - уточнение «Is this new? Did the latest deployment start it?» ушло **с `sessionId` проактивного расследования**, агент понял «this» = ошибки inventory.

### Что узнали

- **Пробел в инструментах для «это новое?»:** агент честно ответил «нет данных о времени деплоев». Сравнение версий ответило бы (в данных `inventory.check` падает на 30% и в v1, и в v2 — проблема не новая), но `compare_versions` есть только у латентного агента, а вопрос ушёл агенту трафика. Нужно: `compare_versions` у агента ошибок и время первого появления каждой версии в `get_services`.
- **Первая доля в окне смешанная** (30–38%, а не 40%): окно захватывает хвост здоровой фазы. Для демо это даже лучше — видно, что детектор считает окно.
- **12 ошибок «(no message)»** в отчёте — корневые спаны демо-данных помечены ошибкой без сообщения. Правильнее, чтобы демо-данные выглядели как настоящий OTel (сообщение на корневом спане).
- **Ссылки на трейсы из одинаковых начальных нулей** (id демо-данных и генератора) выглядели одинаково — теперь показываем начало и конец id.
- **AI-ревью хука было недоступно**, коммит прошёл без него. Раз в шагах 12 и 16 ревью ловило гонки, проверили конкурентные места сами и нашли: расследование из очереди может пережить `collector.close()` и писать в уже закрытые SSE-ответы — `ERR_STREAM_WRITE_AFTER_END` в процесс. Исправили (пишем только в открытые ответы, при закрытии список подписчиков очищается). Первый тест баг **не** воспроизводил — клиент отключался раньше закрытия и подписчик уже удалялся; усиленный тест держит вкладку подключённой в момент закрытия и на старом коде падает. **Тестов 153.**

---

## Шаг 18. `CLAUDE.md` и стартовое приложение Porto Shop

**Чтобы** новая сессия стартовала с той же строгостью, а участникам было на чём работать,
**делаем**:
- `CLAUDE.md` в `nextjs-observe`: структура, команды, правила (минимальные шаги, мутационная проверка, e2e на tarball, журнал), git и хуки, публикация Kitana;
- **стартовое приложение** `workshop-ai-observability` (отдельный репозиторий): Next.js 16 «Porto Shop» с тремя заложенными проблемами — их находят агенты, а не README.

| Проблема | Где | Как проявляется |
|---|---|---|
| медленный платёж в **v2** («ретраи без таймаута») | `lib/payment.ts` | `SHOP_VERSION=v1` — 150–300 ms, `v2` — 1.4–2.5 s |
| **N+1** в каталоге | `lib/catalog.ts` → `lib/db.ts` | `getProductIds` + 5 × `getProductById` подряд |
| **~30% таймаутов** склада | `lib/inventory.ts` | `Inventory service timeout: upstream not responding` → 500 |

- `'use observe'` на файлах `lib/`, `withObserve()`, `instrumentation*.ts` — подключение как у пользователя.
- **Два «деплоя»:** `npm run observer` (наблюдатель отдельно) + `npm run dev:v1` → нагрузка → `npm run dev:v2` → нагрузка. `nxo dev` «всё в одном» терял бы историю v1 при перезапуске — поэтому наблюдатель отдельно, как в проде. Скрипты кросс-платформенные (без `VAR=… cmd`, у участников будет Windows).
- `npm run load [сек]` — нагрузка по всем маршрутам; сначала проверяет, что по `BASE_URL` отвечает **именно магазин**.
- README для участников — на английском.

### Проверка на настоящем приложении и настоящей модели

`OBSERVE_AI=real npm run observer` → `dev:v1` + 40s нагрузки → `dev:v2` + 40s → три вопроса через `/api/chat`:

| Вопрос | Ответ агентов | Карточки | Время |
|---|---|---|---|
| Checkout slow, which deployment? | регрессия в **v2** ×7.5, причина — `chargePayment` | регрессия `POST /api/checkout` v1→v2 330→2487 ms; **горячая точка `lib/payment.ts`** 2450/2487 ms | 51s |
| 500 on product pages | **источник** `checkInventory` (`lib/inventory.ts`), точное исключение, 24%; маршрут и GET — «пассивные жертвы» | ошибки + горячая точка `lib/inventory.ts` | 32s |
| Catalog slow, nothing stands out | **N+1: 5 × `getProductById` в `listProducts`**, 100/126 ms; по `compare_versions` — старая проблема, не из релиза | **N+1 · 5 × getProductById** | 59s |

Все три — ровно заложенные баги, с файлами кода.

### Что узнали

- **Детектор слепнет на реалистичной смеси маршрутов.** 30% ошибок склада — это ~12% от всех серверных запросов (склад — 2 из 5 типов), ниже порога 20%. На синтетическом генераторе этого не было видно. Сработал он лишь раз, на маленьком окне (2 из 7). **Нужно правило по каждой операции** — следующий шаг.
- **Порт 3000 был занят другим приложением** (чужой `next-server`), магазин поднялся на 3002, а нагрузка ушла в чужое приложение (79 «ошибок» из 99). Теперь `load` проверяет, что отвечает магазин, и подсказывает `BASE_URL`. У участников это случится.
- **Шум Next в карточках:** внутренний спан `executing api route (app) /api/...` даёт дубли карточек регрессии и ошибок рядом с настоящими операциями. Стоит предпочитать спаны кода и корневые запросы.
- **AI-ревью хука заблокировало коммит** стартового приложения: `quantity` из тела запроса без проверки шёл в сумму платежа. Исправлено (целое 1–10, иначе 400), проверено шестью запросами.
- Хук перенёс первый коммит нового репозитория в ветку `WOR-…`. Для публикации нужен GitHub-репозиторий, и `master` в нём создаётся осознанно (как было с `nextjs-observe`).
- `next-observe` пока подключён из tarball (`file:…tgz`) — для участников пакет нужно опубликовать в npm.

---

## Шаг 19. Детектор по операциям и битые вызовы инструментов

**Чтобы** финальное демо на Porto Shop срабатывало само и доходило до полного отчёта,
**делаем** две правки, которые показало реальное приложение.

### 1. Правило детектора по каждой операции

- На реалистичной смеси маршрутов 30% ошибок склада — это ~10–12% от всех серверных запросов, ниже общего порога 20%. Детектор молчал.
- Теперь, кроме общей доли, считается доля **по каждой операции** (минимум 5 её запросов в окне). У аномалии `scope: 'all' | 'operation'` и `subject { service, operation }`; вопрос агентам и заголовок в UI — про эту операцию («High error rate · 50% of 10 GET /api/inventory/[id] requests failed in 10s»).
- Если общая доля уже сработала для этого типа, операции отдельно не дублируются. Cooldown у операционных аномалий — свой на каждую операцию.
- Тесты: реалистичная смесь → аномалия по операции, общей нет; минимум выборки для операции; раздельный cooldown (две сломанные операции — обе); без дублей при общей; текст вопроса. Мутации «без правила по операциям» и «общий cooldown» роняют тесты. **Всего 158.**
- На Porto Shop: `npm run dev:v1` + `npm run load 45`, чат открыт заранее — через ~15s аномалия по `GET /api/inventory/[id]` (50%, critical) и расследование **без единого клика**.

### 2. Отчёт оказывался сырым JSON — настоящая причина

- Дважды подряд проактивный отчёт был `{"tool_call":{"name":"latency_agent",…}}`, а в шагах не было вызова `orchestrator → latency_agent`.
- **Первая гипотеза была неверной** («специалист пытался вызвать чужого агента»). Побайтный разбор строки из браузера показал: JSON **битый** — в конце `}}` вместо `}}}`. Модель потеряла закрывающую скобку, строгий парсер Kitana не распознал вызов, и он ушёл как текст; цикл агентов остановился, не вызвав второго специалиста. Вероятно, так же объясняется «специалист не вызвал инструмент» в кейсе 2 шага 10.
- **Kitana 0.1.11:** если ответ *начинается* как вызов инструмента, но не разбирается, пробуем дописать до трёх `}`. Обычный текст, неизвестные инструменты и незакрытые строки вызовом не считаются. Обе сегодняшние строки теперь разбираются; тесты Kitana 52/52, мутация «без починки» роняет тест.
- **`next-observe`:** если итоговый текст всё же начинается с `{"tool_call":`, он не показывается как отчёт — пользователь видит честное «the agents did not finish the report…», карточки остаются. Проверка по началу строки, а не `JSON.parse` — первая версия защиты пропустила именно битый JSON. В инструкции специалистов добавлено «только свои инструменты; если данных не хватает — скажи».
- **Итог на Porto Shop (проактивное расследование, настоящая модель):** до исправления **0 из 2** полных отчётов, после — **2 из 2**: `error_agent` → `get_errors` → `get_trace` → `latency_agent` → статистика, сравнение версий, трейс → полный отчёт с исключением, источником `checkInventory` (`lib/inventory.ts`) и разбором латентности. **Тестов 160.**

### Что узнали

- **Первое правдоподобное объяснение надо проверять на сырых данных.** Две гипотезы подряд оказались неверными; ответ дал побайтный текст ответа, а не пересказ.
- Защита, которая «повторяет» строгость парсера (`JSON.parse`), пропускает ровно тот случай, от которого защищает.
- Kitana 0.1.11 пока установлена из tarball — после публикации поднять зависимость в `next-observe` и в Porto Shop.

---

## Шаг 20. `next-observe` готов к публикации в npm

**Чтобы** участники ставили пакет обычным `npm install`, а не из локального tarball,
**делаем** пакет публикуемым.

- Версия **0.1.0**; `author`, `repository` (с `directory`), `homepage`, `bugs`, `keywords`, `engines: node >= 22`; LICENSE (MIT, Andrei Tazetdinov — как у Kitana).
- README пакета (для страницы npm): быстрый старт в три файла, `'use observe'`, агенты и режимы `OBSERVE_AI`, CLI, переменные окружения, точки входа. Корневой README репозитория переписан: старое описание (`@nextjs/observe`, Docker, Fastify) не соответствовало продукту.
- `prepublishOnly: npm test && npm run build` — непроверенную или несобранную версию опубликовать нельзя.
- **`next` — опциональная peer-зависимость:** ради `nxo collector` (например, на дроплете) npm 7+ иначе ставил бы весь Next.js.

### Как проверили

- `npm pack --dry-run`: в пакете только `dist` (с собранным UI), README, LICENSE — без исходников и тестов; 268 kB, 92 файла.
- **Установка как у пользователя:** пустая папка → `npm install next-observe-0.1.0.tgz` → 64 пакета, **без Next.js** (53 MB) → `npx nxo --help` → `npx nxo collector --demo`: UI отдаётся, чат честно выключен с подсказкой, демо-данные на месте. Сценарий Next-приложения на tarball проверен в шагах 18–19 на Porto Shop.
- 160 юнит-тестов, type-check пакета и UI.

**Публикует пользователь** (npm-вход у него): `cd packages/next-observe && npm publish` — у пакета нет `workspace:`-зависимостей, поэтому здесь подходит обычный `npm publish`; `prepublishOnly` сам прогонит тесты и сборку.

---

## Шаг 21. Свои агенты проекта: `observe.agents.ts`

**Чтобы** участники воркшопа писали своего специалиста сами, а не правили код пакета,
**делаем** специалистов данными и подгружаем файл проекта.

- **Специалист = данные** (`src/agents/specialists.ts`): `name`, `description`, `instruction`, `tools` (подмножество шести инструментов). Встроенные latency/error/traffic — те же, только вынесены из кода в `BUILT_IN_SPECIALISTS`.
- Правила «только факты из инструментов», «только свои инструменты», «по-английски» дописываются к **любой** инструкции автоматически — участник пишет только суть.
- Инструкция оркестратора **генерируется** из описаний специалистов: добавили своего — оркестратор о нём знает.
- `defineSpecialist()` проверяет имя (snake_case, не `orchestrator`), непустые тексты, известные инструменты — ошибка сразу понятная: `unknown tools run_sql — available: …`.
- **`observe.agents.{ts,mts,js,mjs}` в корне приложения:** то же имя, что у встроенного, — заменяет его; новое имя — добавляется. `nxo` показывает это в баннере:
  ```
  agents     observe.agents.ts: latency_agent (replaces built-in); built-in: error_agent, traffic_agent
  ```
- `.ts` без сборки: Node ≥ 22.18 сам убирает типы, поэтому `engines: node >= 22.18`. Предупреждение Node `MODULE_TYPELESS_PACKAGE_JSON` (у Next-приложений нет `"type": "module"`) глушим — только для нашего файла и только на время импорта.

```ts
// observe.agents.ts — то, что пишет участник
import { defineSpecialist } from 'next-observe/agents'

export default [
  defineSpecialist({
    name: 'latency_agent',
    description: 'Finds slow operations and the deployment that made them slow',
    instruction: `You investigate slowness. First call compare_versions: a p95 ratio above 2 between versions is a regression —
name the operation, both versions and the ratio. Then open one slow trace (search_traces, get_trace) and name the span
with the highest selfMs and its code file.`,
    tools: ['compare_versions', 'search_traces', 'get_trace'],
  }),
]
```

### Находка на настоящей модели: модель угадывает имя сервиса

Первый прогон этого агента на Porto Shop (демо-данные, Claude через Kitana): отчёт верный про `chargePayment` в `lib/payment.ts`, но «не могу подтвердить, какой деплой виноват». Причина — у агента участника нет `get_services`, и модель **угадала** `service: "checkout"`. Фильтр по сервису был точным → пустой результат. Для имён операций у нас давно есть фолбэк с `note`, а для сервисов не было.

**Исправили в инструментах, а не в промпте:** неизвестный сервис → данные по всем сервисам + `note: no service "checkout" (services: shop), showing all services instead`; регистр не важен. Повторный прогон: модель снова начала с `checkout`, прочитала заметку, следующим вызовом взяла `shop` — отчёт: `POST /api/checkout` p95 320 → 2510 ms (**×7.8**) между v1 и v2, 2490 ms self-time в `chargePayment` (`lib/payment.ts`), карточки regression + traces + hotspot.

### Как тестировали

- Юнит: валидация `defineSpecialist` (7 случаев), слияние, расследование с MockLlm — каждый специалист вызывает **только свои** инструменты; записывающая модель проверяет, что специалист получил свою инструкцию + общие правила, а оркестратор — список специалистов; CLI на временных проектах: `.ts` с аннотациями типов, одиночный `export default` в `.mjs`, без файла, 5 понятных ошибок (неизвестный инструмент, дубль имени, нет `default`, синтаксическая ошибка, два файла сразу); фолбэк по сервису во всех четырёх фильтрующих инструментах. 181 тест (+4 с настоящей моделью, пропускаются).
- Мутации (9): все инструменты каждому специалисту; встроенный не заменяется; без общих правил; CLI не передаёт специалистов; без проверки дублей; два файла разрешены; старый точный фильтр сервиса; регистрозависимое сравнение; `search_traces` игнорирует найденное имя — каждый раз падает тест.
- E2E на упакованном tarball в Porto Shop под обычным Node (не vitest): баннер, чистый вывод без предупреждения, mock-чат вызывает инструменты замещённого агента, прогон с настоящей моделью — выше.

### Что узнали

- У агента с урезанным набором инструментов модель **додумывает аргументы**. Это хороший момент для воркшопа: почему инструменты должны прощать ошибки и объяснять себя (`note`), а не возвращать пустоту.
- Сделать специалистов данными оказалось дешевле, чем писать документацию «как править investigator.ts»: встроенные агенты стали примером того же формата.

---

## Шаг 22. Внутренние спаны Next.js не дублируют проблемы

**Чтобы** одна проблема была одной находкой, а не тремя,
**делаем** так, чтобы агенты не видели внутренние шаги Next.js.

Что было на настоящем Porto Shop: медленная оплата видна как `POST /api/checkout`, `executing api route (app) /api/checkout` и `chargePayment`, падения инвентаря тоже трижды; в списках операций — `render route`, `resolve page components`, `start response`, `build component tree`…

- **Признак по атрибутам, а не по именам:** у спанов Next есть `next.span_type`. Запрос (`kind: server`, `BaseServer.handleRequest`) — это эндпоинт, его оставляем; остальные спаны с `next.span_type` — внутренности фреймворка (`isFrameworkSpan`, `src/collector/framework.ts`).
- **Агрегаты агентов** (`get_operation_stats`, `compare_versions`, `get_errors`) пропускают внутренние спаны — флаг `hideFramework` в фильтрах хранилища. API и UI показывают всё как было.
- **`get_trace` для агента:** внутренние спаны скрыты, их дети подвешены к ближайшему видимому предку — N+1 «родитель» и первый спан с ошибкой теперь код приложения, а не `executing api route …`. Сколько скрыто — `nextInternalSpansHidden`. Трейс только из спанов Next показывается как есть.
- **Время внутри скрытых спанов не приписываем обработчику:** `selfMs` всегда считается от настоящих детей, а собственное время скрытых спанов идёт в `nextInternalMs` ближайшего видимого предка. Первая версия складывала его в `selfMs` родителя — и настоящая модель отчиталась про «необъяснимые 500 мс в обработчике». Поймали только прогоном на реальном приложении.
- Демо-данные (`--demo`, тесты) теперь как настоящие: спан запроса с `next.span_type` и обёртка `executing api route (app) …` вокруг кода.

### Как тестировали

- Юнит: внутренних спанов нет в статистике, сравнении версий и ошибках; `get_trace` подвешивает детей и считает скрытые; разбиение времени `selfMs` / `nextInternalMs`; трейс только из спанов Next. Ожидания старых тестов (глубина, N+1-родитель, число спанов) обновлены осознанно. 184 теста.
- Мутации (7): спан запроса считается внутренним; ничего не считается внутренним; хранилище игнорирует флаг; нет защиты «весь трейс из Next»; нет переподвешивания; время скрытых спанов теряется; `selfMs` по видимым детям — каждый раз падают тесты.
- E2E на tarball: Porto Shop v1 → v2 под нагрузкой, настоящая модель. Ошибки: две карточки (источник `checkInventory` в `lib/inventory.ts` + эндпоинт-жертва) вместо трёх. «Did the last deployment make anything slower?» → `chargePayment` ×8 (300 → 2414 ms), `lib/payment.ts`.

### Что узнали

- **Холодная компиляция в dev — ложная регрессия.** Медленные запросы к `/api/inventory/[id]` — ровно первые после каждого старта `next dev` (587 ms против ~20): ~480 ms между спанами Next, не покрытые ни одним спаном, — Turbopack компилирует маршрут. На ~18 запросах версии один холодный запрос даёт p95 ×5, и агенты честно называют это регрессией v2. На воркшопе это будет при каждом переключении версии — следующий шаг.
- Сводка трейса для `search_traces` (общая с UI) по-прежнему считает ошибки всех спанов, включая обёртку Next (3 вместо 2) — расхождение с `get_trace` известно и оставлено.

### Kitana 0.1.11 опубликована

Пользователь опубликовал `@kitana-sdk/adk` 0.1.11 (ремонт обрезанных вызовов инструментов, шаг 19) — из `packages/adk` через `pnpm publish` (из корня монорепо `pnpm publish` падает: у корневого `package.json` нет версии). Проверка из реестра: чистая папка, `npm i @kitana-sdk/adk@0.1.11` → зависимость `@kitana-sdk/core ^0.1.6` (не `workspace:`), spike оркестратора с Claude CLI: оба специалиста вызвали инструменты, 5/5 проверок (в одном из двух прогонов модель пересказала текст исключения вместо цитаты — разброс формулировок, не протокол). В `next-observe` — `^0.1.11` в dev и `>=0.1.11` в peer.

---

## Шаг 23. Два пакета: `next-observe` в приложение, `nxo` — обзервер через `npx`

**Чтобы** в приложении участника не было ничего, кроме OpenTelemetry, а обзервер с агентами запускался одной командой,
**делаем** из одного пакета два.

`next-observe` 0.1.0 опубликован в npm (пользователь) и проверен из реестра: чистая папка, CLI, UI, демо, mock-чат. Porto Shop переведён на него. И сразу стало видно проблему: в `package.json` магазина появились `@google/adk`, `@google/genai`, `@kitana-sdk/adk`. Обзервер был командой `nxo` **внутри** `next-observe`, агенты запускались в его процессе, а зависимости Node искал в `node_modules` приложения — поэтому ADK приходилось ставить в приложение (опциональные peer-зависимости). Для воркшопа это плохой пример: обзервер и приложение — разные вещи.

| Пакет | Где | Что |
|---|---|---|
| `next-observe` 0.2.0 | зависимость приложения | `withObserve`, `register`, браузерный OTel, `'use observe'`, типы для `observe.agents.ts`. 14 КБ, без AI |
| `nxo` 0.1.0 | `npx nxo dev`, глобально или на сервере | коллектор, UI, детектор, агенты; ADK, genai, Kitana, zod — **обычные** зависимости |

- Имя `nxo` — потому что `npx nxo dev` работает без установки, только если пакет называется как команда.
- Граница была чистой: код обзервера ничего не импортировал из кода приложения. Переезд — `git mv` с историей: collector, debug, agents, CLI, UI, их тесты и e2e.
- `next-observe/agents` — только типы и `defineSpecialist` (возвращает объект как есть), без зависимостей: файл участника импортирует его из приложения. Проверяет специалистов `nxo` при загрузке файла, как и раньше. Чтобы два списка инструментов не разъехались, тест в `nxo` сравнивает их.
- Из `nxo` убраны ветки «ADK не установлен» и «Kitana не установлена»: теперь это невозможно, подсказка «поставьте ADK в проект» — ровно то, от чего уходим.
- У `next-observe` убраны `bin`, `collector`, `debug`, полные `agents`, `zod`, peer ADK/Kitana; `next` теперь обязательная peer-зависимость (пакет только для приложений).

### Как проверили

- `next-observe`: 36 тестов; `nxo`: 148 тестов (тест «чат выключен без ADK» удалён вместе со сценарием; новый — синхронность списков инструментов, мутация «лишний инструмент» его роняет). Type-check обоих пакетов и UI.
- **Путь участника на tarball'ах:** копия Porto Shop, в зависимостях только `next-observe` 0.2.0 — 91 пакет вместо 277, ни `@google`, ни Kitana, ни бинарника `nxo` в приложении. `npx --package=nxo-0.1.0.tgz nxo dev` → обзервер скачался сам, поднял UI и `next dev`, подхватил `observe.agents.ts` приложения (импорт `next-observe/agents` резолвится без ADK), трейсы идут, mock-чат вызывает инструменты замещённого агента.
- Настоящая модель через Kitana из зависимостей `nxo`: «Why is checkout slow?» → ×7.8 в `chargePayment` (`lib/payment.ts`), карточки regression + hotspot + traces.

### Что узнали

- При первом `npx nxo` npm печатает два `deprecated` (`uuid@9`, `node-domexception`) — из транзитивных зависимостей `@google/adk` 2.2.0 (последняя), убрать не можем. `node-domexception` ещё и через Kitana: `@kitana-sdk/core` держит `@anthropic-ai/sdk@0.30.1` — обновить в Kitana.
- Опубликованный `next-observe` 0.1.0 с `bin: nxo` у кого-то в проекте перекроет `npx nxo` (npx предпочитает локальный бинарник) — поэтому 0.2.0 без `bin`, а 0.1.0 стоит пометить deprecated после публикации.

**Публикует пользователь:** сначала `nxo` 0.1.0, затем `next-observe` 0.2.0 (из `packages/<name>`, `npm publish`). После — Porto Shop: убрать ADK/Kitana из зависимостей, скрипты через `npx --yes nxo@^0.1 …`.

---

## Шаг 24. Обзервер называется `next-observer`

**Чтобы** обзервер можно было опубликовать,
**делаем** другое имя пакета: npm отклонил `nxo`.

`npm publish` → `403 Package name too similar to existing packages nx, xo, np, n3, nib, nps, nwb, nyc, nsp, net`. Проверка имени при `npm view` (404 = свободно) этого не ловит — правило похожести срабатывает только при публикации. `next-observe` 0.2.0 к этому моменту уже вышел с README про `npx nxo dev`.

- Пакет и папка: `nxo` → **`next-observer`** (`git mv`). Пара читается сама: приложение — `next-observe`, обзервер — `next-observer`. Выбрал пользователь из трёх вариантов (`@next-observe/cli` и `@ataztech910/nxo` — длиннее для участника).
- Два бинарника: `next-observer` (его запускает `npx next-observer dev` — npx берёт бинарник с именем пакета) и короткий `nxo` для глобальной установки.
- `bin` без `./`: npm 11 нормализует `./dist/bin.js` → `dist/bin.js` и пишет пугающее «script name … was invalid and removed», хотя бинарник остаётся (у `next-observe` 0.1.0 в реестре он есть). Проверили на минимальном пакете.
- `next-observe` 0.2.1 — только README и описание с новым именем.

### Как проверили

- 148 + 36 тестов, `npm publish --dry-run` без предупреждений, в архиве `bin: { next-observer, nxo }`.
- Копия Porto Shop на `next-observe` 0.2.1 + `npx --package=next-observer-0.1.0.tgz next-observer dev`: баннер, `observe.agents.ts`, трейсы, mock-чат.

**Публикует пользователь:** `next-observer` 0.1.0, затем `next-observe` 0.2.1; `npm deprecate next-observe@0.1.0` с новым текстом и `npm deprecate next-observe@0.2.0` (README про несуществующий `nxo`).

---

## Шаг 25. Холодный старт — не регрессия

**Чтобы** перезапуск `next dev` при «деплое» v2 не выглядел как замедление,
**делаем** так, чтобы обзервер узнавал первый запрос маршрута в новом процессе.

Сначала — что сделали между шагами: пользователь опубликовал `next-observer` 0.1.0 и `next-observe` 0.2.1 (0.1.0 и 0.2.0 помечены deprecated), Porto Shop переведён на них и выложен в GitHub (`ataztech910/workshop-ai-observability`, приватный до воркшопа): в приложении 91 пакет, скрипты — `npx --yes next-observer@^0.1 …`, в README — скачать обзервер заранее (Wi-Fi на конференции). Проверено из реестра: `npm run dev` и сценарий воркшопа на скриптах магазина.

Факт из шага 22: первый запрос маршрута после старта `next dev` — 580 мс против ~16 (Turbopack компилирует маршрут), и на ~18 запросах версии он и есть p95 → «регрессия ×5». Сначала проверили, чем такой спан отличается от обычного, — **ничем**: те же атрибуты, а в ресурсе нет ничего про процесс. Обзерверу не за что зацепиться.

- **`next-observe` 0.2.2:** `register()` добавляет стандартный атрибут ресурса `service.instance.id` — UUID на процесс (`globalThis.crypto`, работает и в Node, и в Edge). Каждый запуск `next dev` и каждый серверный инстанс в проде — свой id.
- **`next-observer` 0.1.1:** хранилище помнит самый ранний серверный спан на (сервис, инстанс, маршрут) — это холодный старт (`isColdStart`). Спаны приходят пачками не по порядку: более ранний вытесняет. Без `service.instance.id` (старый `next-observe`, чужие OTel-источники) ничего не помечается.
- Агентам: `get_operation_stats` и `compare_versions` считают латентность без холодных стартов и пишут в `note`, сколько исключено; операция, у которой только холодные запросы, не пропадает — помечена `onlyColdStarts`. `get_trace` ставит `coldStart: true` на такой запрос. Ошибки не прячем: упавший холодный запрос — всё равно ошибка.
- Детектор аномалий не видит холодные старты — перезапуск не повод для расследования.

### Как тестировали

- `next-observe`: id есть и одинаковый для всех вызовов в процессе (37 тестов).
- `next-observer`: отдельный файл тестов — пометка по инстансу и маршруту, порядок прихода, без id и не-серверные спаны, после вытеснения; сценарий «v1 30 запросов, перезапуск, v2 18 запросов» — p95 v2 без компиляции и ratio < 1.5; операция только из холодных; отметка в `get_trace`; детектор через настоящий приём OTLP. 157 тестов. Мутации (9): первый пришедший вместо самого раннего; не-серверные спаны; ключ без инстанса; холодные не исключаются; операции только из холодных пропадают; `compare_versions` без фильтра; `get_trace` без отметки; детектор видит холодные; заметка считает «только холодные» — каждый раз падают тесты (одна мутация сначала не применилась из-за экранирования в shell — повторили скриптом).
- E2E на tarball'ах: копия Porto Shop, `next-observer` отдельно, v1 → перезапуск → v2 под нагрузкой. Mock: карточки регрессий только `chargePayment` и `POST /api/checkout`, «8 cold-start request(s) left out» (4 маршрута × 2 запуска). Настоящая модель: «v2 — `chargePayment` ×9.1 (`lib/payment.ts`), checkout ×8.1, остальное ~1.1–1.2× — обычный шум».

### Что узнали

- Отличить холодный запрос по самому спану нельзя — нужен идентификатор процесса. Стандартный `service.instance.id` закрывает это и в dev, и для холодных стартов serverless в проде.
- Карточка «regression» появилась и для `GET /api/inventory/[id]` (p95 115 → 140 мс, ×1.2) — не из-за латентности (порог ×1.5), а из-за второго условия: доля ошибок выросла на ≥ 0.1. У инвентаря случайные 30% падений, и на 15–20 запросах доля скачет между версиями. Модель правильно назвала это шумом; карточке нужен минимум запросов или проверка значимости разницы долей.

**Публикует пользователь:** `next-observer` 0.1.1 и `next-observe` 0.2.2. После — Porto Shop: `next-observe@^0.2.2`.

---

## Шаг 26. Сервер шлёт в любой OTLP-бэкенд: стандартные переменные OTel

**Чтобы** приложение с `next-observe` могло отправлять трейсы не только в наш обзервер,
**делаем** серверный экспортёр настраиваемым так, как принято в OpenTelemetry.

Пользователь спросил про транспорт, и разбор нашёл четыре ограничения: путь `/v1/traces` дописывался всегда; из заголовков был только `x-api-key`; адрес один; браузерный прокси — rewrite, зашитый при `next build`; а обзервер не принимает protobuf. Решили закрыть все, по шагу: 26 — сервер, 27 — браузерный прокси, 28 — несколько получателей, 29 — protobuf в обзервере.

- `register()` читает стандартные `OTEL_EXPORTER_OTLP_ENDPOINT` (база, `+ /v1/traces`), `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (полный URL как есть), `OTEL_EXPORTER_OTLP_(TRACES_)HEADERS` (`k=v,k2=v2`, значения percent-encoded) и `OTEL_EXPORTER_OTLP_(TRACES_)PROTOCOL` (`http/json` | `http/protobuf`; `grpc` — предупреждение и JSON: экспортёры `@vercel/otel` работают через fetch, в Node и Edge).
- Опции: `register({ endpoint, tracesUrl, headers, protocol })`.
- **Приоритет:** опции → `OBSERVE_ENDPOINT` → `OTEL_*` → локальный обзервер. `OBSERVE_*` главнее, иначе глобальная `OTEL_EXPORTER_OTLP_ENDPOINT` у человека увела бы трейсы мимо `next-observer dev`.
- Битые записи в заголовках пропускаются, а не роняют запуск приложения.
- Собственные запросы экспортёра в чужой бэкенд тоже не трассируются (`ignoreUrls`).
- `next-observe` 0.3.0 (новые возможности).

### Как тестировали

- 43 теста: база и полный URL, приоритеты (`OBSERVE` над `OTEL`, опции над всем), порядок слияния заголовков, разбор с битыми записями и процент-кодированием, выбор protobuf-экспортёра, `grpc` → предупреждение. Мутации (7): игнор полного URL; `OTEL` главнее `OBSERVE`; игнор traces-заголовков; без декодирования; битые записи не пропускаются; protobuf игнорируется; запросы экспортёра трассируются — каждый раз падает тест.
- E2E: фейковый «чужой бэкенд», записывающий путь, заголовки и тип; копия Porto Shop на tarball без `OBSERVE_ENDPOINT`, только `OTEL_*`: `POST /custom/otlp/traces`, `Authorization: Bearer xyz`, `x-team: porto` — в `application/json` и в `application/x-protobuf`.

### Что узнали

- Браузер пока по-прежнему идёт через rewrite на `OBSERVE_ENDPOINT` — это шаг 27. Наш обзервер на protobuf отвечает 415 — шаг 29.

---

## Шаг 27. Браузерный прокси при запуске + две ошибки шага 26

**Чтобы** адрес и ключи для браузерных трейсов задавались при запуске, а не при сборке, и не попадали в браузер,
**делаем** необязательный маршрут-прокси `next-observe/proxy`.

- Подложить маршрут из библиотеки в приложение Next не даёт: нужен файл в самом приложении. Поэтому по умолчанию ничего не меняется (rewrite, ноль файлов — для `next dev` и воркшопа этого хватает), а для прода — один файл в одну строку: `app/api/next-observe/[...path]/route.ts` → `export { POST } from 'next-observe/proxy'`. `withObserve()` находит его (в `app/` или `src/app/`) и направляет `/__observe/*` во внутренний маршрут вместо внешнего URL.
- `__observe` как папку использовать нельзя: папки с `_` в app router — приватные, не маршруты. Отсюда `api/next-observe`.
- Обработчик берёт настройки так же, как `register()` (общий модуль `exporter-config.ts` без `@vercel/otel`): `OBSERVE_*`, `OTEL_EXPORTER_OTLP_*`, заголовки добавляются на сервере. Только `v1/traces` (остальное 404), лимит 5 МБ (по заголовку и по факту), статус бэкенда пробрасывается, недоступный бэкенд → 502.

### Две ошибки шага 26, найденные прод-сборкой

E2E в этот раз — `next build` без адресов + `next start` с `OTEL_*` и настоящий браузер (Playwright). Фейковый бэкенд получил лишнее:

1. **Каждый серверный спан уходил дважды.** `@vercel/otel` 2.1.3 при заданном `OTEL_EXPORTER_OTLP_(TRACES_)ENDPOINT` сам добавляет свой экспортёр (по умолчанию protobuf) рядом с переданным `traceExporter` — нашли в его коде. В e2e шага 26 я считал запросы через `uniq -c`, и два одинаковых JSON-запроса склеились в «2» — принял за две пачки. Исправление: `spanProcessors: []`, а на Vercel с его коллектором (`VERCEL_OTEL_ENDPOINTS`, трейс-дрейны) — `['auto']`, там он добавляет только его.
2. **Имя сервиса в проде — `next-app`.** Next подставляет в сборку только буквальное `process.env.OBSERVE_SERVICE_NAME`; в шаге 26 разбор переехал на `env.OBSERVE_SERVICE_NAME` (параметр `env = process.env`) — подстановка пропала, а у `next start` такой переменной нет. В `next dev` Next кладёт `env` из конфига в `process.env`, поэтому dev этого не показал. Вернул буквальное обращение.

Обе ошибки — в смерженном, но не опубликованном 0.3.0; опубликованный 0.2.2 их не содержит.

### Как тестировали

- 54 теста `next-observe`: прокси (пересылка с серверными заголовками, адрес читается при запросе, статус бэкенда, только трейсы, 413 по заголовку и по размеру, 502), поиск маршрута в `app/` и `src/app/`, выбор rewrite; один экспортёр и `auto` на Vercel; имя сервиса из буквального `process.env`. Мутации (11) — каждая роняет тест.
- E2E: копия Porto Shop с файлом маршрута, `next build` **без** адресов (в `routes-manifest` только `/__observe/:path*` → `/api/next-observe/:path*`), `next start` с `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` + `Authorization` только при запуске, открыли страницы в браузере: бэкенд получил ровно 2 запроса — браузерные спаны (`workshop-ai-observability-browser`) и серверные (`workshop-ai-observability`), оба JSON, оба с `Bearer runtime-secret`.

### Что узнали

- Считать запросы нужно по одному, а не `uniq -c`: одинаковые дубли склеиваются.
- Прод-сборка ловит то, чего не видно в `next dev` (подстановка env, поведение `@vercel/otel`) — для транспорта e2e делаем на `next build` + `next start`.

---

## Шаг 28. Несколько получателей трейсов

**Чтобы** трейсы шли одновременно в наш обзервер и в корпоративный OTel-бэкенд,
**делаем** список получателей вместо одного адреса.

- `OBSERVE_*` описывает обзервер, `OTEL_EXPORTER_OTLP_*` — OTel-бэкенд. Заданы оба — каждый спан идёт в оба, **у каждого свои заголовки и протокол**: `Authorization` вендора не попадает в обзервер, `x-api-key` обзервера — к вендору. Это меняет правило шага 26 («`OBSERVE` главнее, `OTEL` игнорируется») — теперь работают оба.
- Ничего не задано — локальный обзервер; это же адрес по умолчанию у самого OTel, поэтому `OTEL_*_HEADERS`/`_PROTOCOL` применяются к нему (как в шаге 26). Один и тот же URL с обеих сторон — один получатель, заголовки объединяются.
- Из кода — полный контроль: `register({ destinations: [{ url, headers, protocol }, …] })`.
- `register()`: по `BatchSpanProcessor` на получателя, без `traceExporter` и без `'auto'` (кроме Vercel с его коллектором). Все адреса получателей — в `ignoreUrls`.
- Прокси браузерных спанов рассылает всем; браузер получает ответ первого получателя, остальные отправляются фоном — медленный или упавший вендор не задерживает и не ломает ответ. Без маршрута-прокси (rewrite) браузерные спаны идут только в обзервер.

### Как тестировали

- 59 тестов `next-observe`: оба получателя со своими заголовками и протоколом, один URL с двух сторон, `destinations`, по процессору на получателя; прокси — каждому свои заголовки, ответ первого, медленный/падающий второй не мешает. Мутации (8): OTEL-получатель теряется при заданном обзервере; `Authorization` вендора утекает в обзервер; ключ обзервера утекает к вендору; нет объединения одинаковых URL; `destinations` игнорируется; `register` шлёт только первому; прокси шлёт только первому; прокси ждёт остальных — каждый раз падают тесты.
- E2E: прод-сборка Porto Shop с маршрутом-прокси; обзервер — опубликованный `next-observer` из npm; «вендор» — фейковый бэкенд, считающий спаны. После захода на страницу в браузере: обзервер прибавил **23** серверных и **13** браузерных спанов, вендор получил ровно **23** и **13**, по одной пачке, с `Bearer vendor-secret`. Дублей нет.

---

## Шаг 29. Обзервер принимает OTLP protobuf и gzip — трейсы от любого OTel

**Чтобы** в `next-observer` можно было слать трейсы из любого приложения со стандартным OTel SDK или из OTel Collector,
**делаем** приём `application/x-protobuf` и `Content-Encoding: gzip` на `/v1/traces`.

- В плане (`SPRINTS.md`, фаза B) стоял `protobufjs` + `.proto`-файлы. Сделали свой декодер wire-формата (~200 строк, без зависимостей): из protobuf нужны только сообщения трейсов (`ExportTraceServiceRequest` → `ResourceSpans` → `ScopeSpans` → `Span`, `Event`, `Status`, `KeyValue`, `AnyValue`). Он переводит protobuf в ту же структуру, что OTLP/JSON, — дальше общий проверенный путь (`decodeOtlpJson`).
- 64-битные времена и `int` — через BigInt; отрицательные `int64` (varint в дополнительном коде) — `BigInt.asIntN`; неизвестные поля пропускаются (совместимость с будущими версиями), неверная длина и неподдерживаемый wire type — ошибка → 400.
- gzip для JSON и protobuf; лимит размера действует и **после распаковки** (`maxOutputLength`) — маленький gzip не раздуется в гигабайты (413). Другие кодировки и типы — 415 с подсказкой. На protobuf отвечаем пустым `ExportTraceServiceResponse` в protobuf, как требует OTLP.

### Как тестировали

- Контракт на настоящих байтах: одни и те же спаны через официальные `JsonTraceSerializer` и `ProtobufTraceSerializer` → после декодирования **полностью совпадают** (id, времена, kind, атрибуты включая отрицательный int, массивы, юникод, события, статус, ресурс, scope). Плюс обрезанное сообщение, лишнее неизвестное поле, пустое тело. Приём по HTTP: protobuf, gzip для обоих форматов, битый protobuf/gzip, gzip-бомба 64 КБ при лимите 1 КБ → 413. 167 тестов.
- Мутации (12). **Две сначала выжили:** без проверки длины поля и без ошибки на неизвестный wire type тесты проходили — «обрезанное сообщение» ловилось глубже, а случай «поле заявляет больше байт, чем осталось» молча давал укороченные данные. Добавили точечные тесты на вручную собранных байтах — теперь все 12 роняют тесты.
- E2E на tarball `next-observer` 0.2.0: (1) обычный Node-сервис на стандартном OTel SDK (`@opentelemetry/exporter-trace-otlp-proto`, `compression: 'gzip'`), без Next и без нашего пакета — 10 спанов `billing-worker` b7, ошибка `renderPdf` видна; (2) Porto Shop на `next-observe` 0.3.0 с `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` — спаны магазина на месте. Ни одного 415.

### Что узнали

- Мутация, которая «выжила», почти всегда значит, что тест ловит ошибку не там, где мы думаем. Обрезанный protobuf падал на чтении varint дальше по потоку, а не на проверке длины.

**Публикует пользователь:** `next-observe` 0.3.0 (шаги 26–28) и `next-observer` 0.2.0 (шаг 29).

---

## Шаг 30. Карточки регрессий без шума

**Чтобы** на экране воркшопа карточка «регрессия» означала настоящую регрессию,
**делаем** пороги, которые отличают сигнал от случайности.

Сначала — между шагами: пользователь опубликовал `next-observe` 0.3.0 и `next-observer` 0.2.0, проверили из реестра (обычный OTel-сервис в protobuf+gzip и магазин). Porto Shop — PR #1: `next-observe@^0.3.0` и `npx next-observer@^0.2` (диапазон `^0.1` никогда не взял бы 0.2.x).

- **Доля ошибок — z-тест для двух долей** (95%, `|z| ≥ 1.96`, минимум по 10 запросов в каждой версии; `debug/stats.ts`). Раньше хватало прироста ≥ 0.1, а у инвентаря случайные 30% падений: на 15–20 запросах доля «прыгает» на 10–15 пунктов между версиями. `compare_versions` отдаёт агенту `errorRateChangeSignificant`, описание инструмента объясняет, что `false` — шум; карточка — только при приросте ≥ 0.1 **и** значимости.
- **Латентность — ещё и абсолютный минимум +50 мс** к порогу ×1.5. Нашлось на реальных данных: `getProductById` 21.9 → 49 мс — ×2.2, но +27 мс у быстрой операции без всякого бага. Цифры остаются в выводе инструмента — агент их видит, просто без карточки.

### Как тестировали

- Z-тест на цифрах из реальных прогонов: 29% → 33% (32/18 запросов) и 29% → 44% — шум; 0% → 30% (30/30) — сигнал; те же +15 пунктов на 2000/2000 — сигнал; меньше 10 запросов, нулевой разброс — никогда; падение тоже значимо. Карточки: прирост ≥ 0.1 без значимости — нет карточки; ×2.2 при +27 мс — нет; ×1.1 при +100 мс — нет; ×10.7 при +2254 мс — есть. 174 теста.
- Мутации (9): карточка без значимости; без минимума запросов; односторонний тест; порог 0.2; неверная стандартная ошибка; флаг всегда `true`; без абсолютного минимума; без отношения (сначала выжила — добавили случай «1000 → 1100 мс»). Ещё одна выжила честно: проверка `se === 0` оказалась мёртвым кодом (`0 / 0 = NaN`, а `NaN >= 1.96` — `false`), убрали её.
- E2E: Porto Shop v1 → v2 под нагрузкой, обзервер из tarball (в одном прогоне — прямо в скрипте, чтобы видеть `compare_versions` целиком): инвентарь 26.7% → 22.2% и 14% → 0% — `significant=false`; карточки регрессий — только `chargePayment` ×8.1 и `POST /api/checkout` ×7.3.

### Что узнали

- «Порог по отношению» в одиночку шумит на быстрых операциях, «порог по разнице долей» — на малом трафике. Нужны оба измерения: относительное и абсолютное (или статистическое).

---

## Шаг 31. `compare_versions` помнит предыдущую версию после деплоя

**Чтобы** агент называл виновный деплой и через 15 минут после него,
**делаем** сравнение с последним окном трафика предыдущей версии, когда в текущем окне её уже нет.

Начинали с `--demo`, которое «замолкает» через пару минут, но сначала проверили, отчего. Проба на часах демо, сдвинутых вперёд: `+0` и `+5 мин` — `chargePayment v1→v2 ×8.3`; `+10 мин` — «only one version seen — nothing to compare». История v1 в демо — 12–8 минут назад, окно по умолчанию — 15 минут. **Это не про демо, а про прод:** после деплоя старая версия перестаёт слать трафик, и через окно сравнивать становится не с чем — ровно тогда, когда нужен ответ «какой деплой виноват». «Живое» демо — следующим шагом.

- Хранилище помнит, когда каждую версию видели в последний раз (`versionLastSeenMs` в `getServices`).
- Если у операции в окне одна версия, а у сервиса есть предыдущая, `compare_versions` берёт статистику предыдущей версии за **её последнее** окно той же длины и пишет в `note`: «v1 has no traffic in this window — compared with its last 15 min of traffic (until 9 min ago)».
- Именно последнее окно, а не вся история: давний инцидент в v1 не должен спрятать регрессию.

### Как тестировали

- Узкое окно (только v2) — сравнение v1 → v2 есть, с заметкой; через 20 минут — по-прежнему v1 → v2 ×8+; сервис действительно с одной версией — «only one version»; v1 с инцидентом 2 часа назад (3000 мс) и здоровая перед деплоем (200 мс) → сравнение с 200 мс, ×12. Два старых теста сужали окно, чтобы «спрятать» v1, и ждали «сравнивать не с чем» — это и было багом, переписали. 181 тест.
- Мутации (5): старое окно не используется; вся история вместо последнего окна; первая версия вместо предыдущей; без заметки; «первое появление» вместо «последнего» — каждый раз падают тесты.
- E2E в реальном времени: `next-observer collector --demo` из tarball, через 8½ минут (v1 уже вне окна) вопрос в чат → карточки регрессий `chargePayment` v1 → v2 ×8.3 и `POST /api/checkout` ×7.8.

---

## Шаг 32. Живой `--demo`: трафик не кончается, детектор срабатывает сам

**Чтобы** `next-observer collector --demo` работал как запасной вариант для сцены сколько угодно долго,
**делаем** демо с живым трафиком.

Шаг 31 починил главное (сравнение версий через 15 минут). Оставалось: демо-история заканчивалась минуту назад — агент трафика через пару минут видел «тишину», а детектор вообще не получал демо-спаны и ничего не находил.

- После засева истории каждые 2 с — свежий тик v2 с теми же тремя багами (`liveDemoSpans`): медленная оплата, 30% падений инвентаря, N+1 в каталоге. Спаны идут и в хранилище, и в детектор — как настоящий трафик. При остановке таймер гасится до закрытия коллектора.
- **Первый вариант давал три почти одинаковых расследования за 25 секунд.** Генератор ронял инвентарь пачкой (`tick % 10 < 3`), а в первые секунды в окне детектора мало запросов: одна ранняя ошибка — уже 22% по приложению, и вместе с «ошибками инвентаря» срабатывали «ошибки по всему приложению». Случайные падения в жизни размазаны: теперь тики 2, 5, 8 из каждых 10 — те же 30%, по приложению максимум ~15%, у инвентаря стабильно ~33%.

### Как тестировали

- Генератор: только v2, оплата ≥ 1.4 с, 3 из 10 падений инвентаря, каталог каждый 5-й тик с N+1, уникальные id. Таймер (фейковое время): тик каждый интервал, детектор получает те же спаны, после `stop()` — ничего. Детектор на живом трафике находит «ошибки инвентаря» и «задержку по приложению», но не «ошибки по приложению». CLI: число спанов растёт. 181 тест. Мутации (6): детектор не получает спаны; `stop()` не работает; инвентарь не падает; CLI без живого демо; падения пачкой; падение в первом тике — каждый раз падают тесты.
- E2E в реальном времени на tarball 0.2.3 с включённым детектором: за 40 секунд — ровно две аномалии (задержка по приложению; ошибки `GET /api/inventory/[id]`), по каждой агенты сами провели расследование (5 карточек: регрессии `chargePayment` и checkout, ошибки инвентаря, трейсы). Через 3 минуты последний спан — 1.4 с назад.

---

## Шаг 33. Porto Shop: стартовое состояние и решения блоков

**Чтобы** участник начинал с `git clone` и мог догнать группу одной командой,
**делаем** `master` магазина стартом блока 2, а решения блоков 3 и 4 — git-тегами.

`next-observer` 0.2.3 (живой `--demo`) опубликован пользователем; `npx next-observer@^0.2` его подтянул.

- По плану воркшопа участники **сами** добавляют `'use observe'`, браузерную инструментацию и свой спан (блок 3) и пишут Latency Agent (блок 4), а магазин был уже доделан. Старт (`master`): `withObserve` + `instrumentation.ts` — серверные трейсы видны сразу; без директив в `lib/` и без `instrumentation-client.ts`.
- **Спойлеры:** в коде лежали комментарии «BUG 1 — slow payment, introduced in v2…», «BUG 2 — N+1…», «BUG 3 — times out on ~30%…» — участник открыл бы файл поставить директиву и прочитал ответ. Заменены на нейтральные (что делает код); описание багов для ведущего — в этом плане.
- Решения — ветка `solutions` поверх старта, теги после мержа: `block-3-instrumentation` — директивы, `instrumentation-client.ts`, свой спан `placeOrder` с атрибутами заказа (`@opentelemetry/api`); `block-4-agents` — свой `latency_agent` в `observe.agents.ts`. В README магазина — как догнать: `git stash -u && git checkout block-3-instrumentation && npm install`.

### Как проверили

- Блок 3 на `npm run observer` + `npm run dev:v2`: `placeOrder` (`order.quantity`, `product.id`, `order.total_cents`) — родитель `getProductById` (`lib/db.ts`) и `chargePayment` (`lib/payment.ts`); браузерные спаны пришли из настоящего браузера (Playwright).
- Блок 4, настоящая модель, сценарий 3 («каталог медленный, но ни один спан не выделяется»). **Первый вариант агента провалился:** у него не было `get_operation_stats`, и модель гадала имена — искала сервис `product-catalog`, трейсы по слову «catalog», получила фолбэк «все трейсы», открыла медленный **checkout** и честно написала «данных для диагноза каталога нет». С `get_operation_stats` и шагом «сначала посмотри операции и используй их точные имена» — `listProducts` → трейс → **N+1: 5 последовательных `getProductById` в `lib/catalog.ts`**, карточка n-plus-one.

### Что узнали

- Готовый пример для блока 4: агенту нужен инструмент **обзора** (какие операции есть), иначе он не знает имён и подставляет слова пользователя. «Минимальный» агент на 2 инструментах из плана этот сценарий не проходит — в плане теперь 4.

---

## Шаг 34. `npx next-observer init` — подключение одной командой

**Чтобы** любое Next-приложение (и Porto Shop на старте воркшопа) подключалось к телеметрии одной командой,
**делаем** `init` в обзервере.

Вопрос пользователя: «в магазине на старте только серверная инструментация — а `npx next-observer init` её добавит?» Команды не было (бэклог). Сделали — и она меняет начало воркшопа: старт может быть **голым** Next-приложением.

- `init` в папке приложения: ставит `next-observe` пакетным менеджером проекта (по lock-файлу: npm/pnpm/yarn/bun); оборачивает экспорт `next.config` в `withObserve()`; создаёт `instrumentation.ts` и `instrumentation-client.ts` (в `src/`, если приложение там; `.js`, если нет TypeScript; `next.config.mjs` вместо `.ts` для JS-приложения); добавляет скрипт `observe` = `npx --yes next-observer@^X dev`; `--proxy` — маршрут-прокси из шага 27.
- **Ничего не ломать:** уже подключённое не трогается (повторный запуск — всё `unchanged`); свой `register()` не переписывается — `manual` с подсказкой; в существующий `instrumentation-client` добавляется только импорт сверху; конфиг, который нельзя переписать наверняка (`export { a as default }`, два экспорта), — `manual`, файл не тронут.
- `next.config` не разбирается парсером: `export default nextConfig` → `export default withObserve(nextConfig)` (так выглядит у create-next-app); любое другое выражение → `const nextObserveConfig = <выражение>` + экспорт в конце; CommonJS (`module.exports`, `.cjs`, `.js` без `"type": "module"`) — через `require`.

### Как тестировали

- 14 тестов `init` + 2 теста CLI: синтаксис переписанных конфигов проверяет **сам Node** (`node --check`, для `.ts` — с удалением типов; TypeScript 7 нативный, JS-API `transpileModule` у него нет), и проверено, что проверка ловит битый файл. Свежее приложение, повторный запуск, `src/app`, `--proxy`, свой `register()`, свой `instrumentation-client`, CommonJS и `.cjs` в `"type": "module"`, неудачная установка, не-Next папка, JS-приложение без конфига. 197 тестов всего.
- Нашлось по ходу: в JS-приложении `init` создавал `next.config.ts` рядом с `.js`-файлами; подсказка «npm run observe» в pnpm-проекте. Исправлено.
- Мутации (10): повторное оборачивание; переписывание при двух экспортах; повторная установка; чужой `register()` считается подключённым; код `instrumentation-client` теряется; `src/` игнорируется; `.cjs` как ESM (сначала выжила — добавили тест); не-Next принимается; `.ts`-конфиг в JS-приложении; без «простого» пути для переменной — каждая роняет тесты.
- E2E: `npx create-next-app@latest --yes` → `npx --package=<tarball> next-observer init` → конфиг `export default withObserve(nextConfig)`, второй запуск — всё `unchanged`, `next build` проходит; `next-observer dev` + настоящий браузер → `fresh-app` (сервер, 17 спанов) и `fresh-app-browser` (браузер, 22 спана), без ошибок в консоли.

### Дальше

- Опубликовать `next-observer` 0.3.0 — до этого скрипт `observe` (`npx next-observer@^0.3`) не найдёт пакет.
- Porto Shop: старт = голое приложение (без `next-observe`), блок 2 начинается с `npx next-observer init`.

---

## Шаг 35. Porto Shop начинается с голого приложения

**Чтобы** блок 2 показывал главное — подключить чужое Next-приложение одной командой,
**делаем** старт магазина без телеметрии, а состояние после `init` — тегом.

Между шагами: `npm run doctor` (PR магазина #5) — Node ≥ 22.18, `npm install`, обзервер скачан, порт 4318 (свободен или там уже обзервер — по телу `/health`, с таймаутом: хук ревью поймал зависание), теги, настоящий AI (необязательно). Каждый сбой — с подсказкой; проверено на всех случаях. `next-observer` 0.3.0 (с `init`) опубликован.

- `master` = голое приложение: без `next-observe`, `withObserve` и файлов инструментации (32 пакета вместо 92). Скрипты и README — на `next-observer@^0.3`; `doctor` не требует `next-observe` на старте.
- Теги перенесены (репозиторий приватный, клонов участников ещё нет): `block-2-start` (голое), **`block-2-init`** (новый — результат **настоящей** `npx next-observer@^0.3 init` из npm, а не ручная правка), `block-3-instrumentation` (+ директивы, `placeOrder`), `block-4-agents` (+ агент). Коммиты решений ушли **только тегами**, без ветки — чтобы не повторилась история с PR #3, когда ветка решений была смержена в `master`.

### Как проверили

- Чистый клон: `master` = `block-2-start`; для каждого тега — ожидаемое состояние, `next build` и `npm run doctor` проходят.
- `npx next-observer init` на `block-2-start` даёт дерево, **идентичное** `block-2-init` (кроме lock-файла): участник после `init` — ровно там, куда ведёт тег для отставших.
- `npm run observe` на `block-2-init` поднимает обзервер и магазин, трейсы идут.

---

## Шаг 36. Генеральная репетиция; детектор видит медленную операцию со средним трафиком

**Чтобы** найти шероховатости до 10 ноября, **прошли воркшоп как участник**: чистый клон Porto Shop, настоящая модель (Claude через Kitana).

### Репетиция

- Блок 0: `npm install`, `npx next-observer@^0.3 --help`, `npm run doctor` — всё зелёное.
- Блок 2: `npx next-observer init` → `npm run observe` → магазин и обзервер; в браузере — трейсы, браузер и сервер склеены в одном трейсе.
- Догонялка из README: `git stash -u && git checkout block-4-agents && npm install` — работает.
- Блок 4, `npm run observer` (`OBSERVE_AI=real`) + v1 → v2 под `npm run load`, три вопроса из README — **все решены верно**: checkout — v1 → v2 ×7.2, 98.8% времени в `chargePayment` (`lib/payment.ts`) внутри `placeOrder`; 500 — `checkInventory`, 31.7%, «Inventory service timeout», источник `lib/inventory.ts`; каталог — N+1: 5× `getProductById` в `listProducts` (`lib/catalog.ts`), деплой ни при чём. Детектор сам нашёл ошибки инвентаря, агенты расследовали без вопроса.

**Находки:** (1) детектор **не поднял тревогу по медленному checkout**; (2) в списке трейсов — `fetch GET https://registry.npmjs.org/…` (проверка обновлений `next dev`); (3) браузерные трейсы называются просто `GET`; (4) `git checkout <тег>` пугает «detached HEAD»; (5) первый запрос 671 мс против 18 на сервере — в UI не объяснено; (6) в шапке UI `next-observe` вместо `next-observer`; (7) `npx` запускает бинарник `nxo`.

### Находка 1 — окно детектора

Детектор, логирующий каждую проверку, под той же нагрузкой: `npm run load` — 3 запроса/с на 5 маршрутов, checkout ≈ 0.6/с; в 10-секундное окно попадает **3–5 checkout** при `minSamples: 5` — правило по операции почти никогда не судит, а по приложению медленных ≈ 20% при пороге 30%. Сработает или нет — дело случая (в одном прогоне сработало, на репетиции нет).

- У правила по операции своё окно — `operationWindowMs: 30_000` (≈ 15 checkout); по приложению — по-прежнему 10 с, чтобы всплески ловились быстро. Аномалия несёт своё окно — вопрос агентам и UI говорят «за последние 30 с».

### Как тестировали

- Тест на сценарий репетиции: 3 checkout по 2.4 с каждые 5 секунд среди остального трафика → `high_latency` по `POST /api/checkout`, при этом правило по приложению не срабатывает. Окна: через 11 с — только аномалия операции, через 31 с — ничего. 198 тестов. Мутации (4): окно операции снова 10 с; операция судится по короткому окну; приложение — по длинному; аномалия сообщает не своё окно — каждый раз падают тесты.
- E2E: тот же логирующий детектор на tarball 0.3.1, магазин v1 → v2 под `npm run load`: на v1 медленных 0, тревоги по задержке нет; на v2 через ~20 с — `high_latency: POST /api/checkout`.

---

## Шаг 37. Шероховатости репетиции: шум, имена, потеря браузерных спанов

**Чтобы** экран участника был понятным и ничего не терял,
**делаем** пачку правок по находкам репетиции (шаг 36).

`next-observer` 0.3.1 (окно детектора) опубликован.

- **Шум `next dev`.** Трейс `fetch GET https://registry.npmjs.org/…` — это `next dev` проверяет новую версию Next из серверного процесса. `register()` не трассирует `https://registry.npmjs.org/` — **только в development**: если прод-приложение само ходит в npm, это его трафик.
- **Имена браузерных трейсов.** OTel называет HTTP-клиентский спан только методом (`GET`) — так и должно быть для группировки. Имя спана не трогаем, а подпись для человека (`spanLabel`) добавляет путь из `url.full`: в списке трейсов и в waterfall — `GET /api/inventory/2`.
- **Шапка и заголовок UI** — `next-observer`.
- **`git checkout -B workshop <тег>`** в README магазина (PR магазина #7) — вместо абзаца про «detached HEAD» одна строка.
- **`nxo` в `ps`** — разобрали: оба бинарника — ссылки на один `dist/bin.js`, при одинаковой цели npm берёт первый; поведение и баннер одинаковые, чинить нечего.
- **Нашлось по ходу — потеря браузерных спанов.** Комментарий в `client.ts` утверждал, что браузерный `BatchSpanProcessor` сам отправляет накопленное при скрытии страницы. Проверили код `sdk-trace-base`/`sdk-trace-web` — такого там нет. Пачка копится 2 с, и всё, что не ушло до перехода на другую страницу, терялось. `flushWhenHidden`: на `pagehide` и при скрытии вкладки — `forceFlush()`; экспортёр шлёт через `fetch` с `keepalive` (до 64 КБ), запрос переживает уход со страницы.

### Как тестировали

- `next-observe`: 62 теста — игнор npm только в development; `flushWhenHidden` на настоящих `EventTarget` из Node (уход и скрытие — отправка, показ — нет; ошибка отправки не вылетает в страницу). `next-observer`: подпись спана, имя корня в списке трейсов. Мутации (6): серверные спаны тоже переподписываются; полный URL вместо пути; список с `GET`; нет `pagehide`; отправка и при показе вкладки; reject вылетает наружу — каждый раз падают тесты.
- E2E в настоящем браузере на tarball'ах в клоне репетиции: шапка `next-observer`, трейса npm нет, браузерные трейсы — `GET /api/inventory/3` (браузер + сервер).
- **Потеря спанов — с контролем:** «открыть товар → 1 с → уйти». С опубликованным клиентом 0.3.0 браузерный спан **пропал** (сервер оба запроса получил); с новым — дошёл. Отдельно: при уходе через 112 мс спана нет и с исправлением — запрос ещё шёл, незавершённый спан отправить нечем; это не потеря пачки, а оборванный запрос.

### Что узнали

- Комментарий «библиотека сама сделает X» — гипотеза, пока не проверена по коду этой версии библиотеки.
- E2E на потерю данных нужно с контролем на старой версии и с правильным таймингом — иначе легко «доказать» не то.

---

## Шаг 38. Холодный старт виден человеку, не только агентам

**Чтобы** «671 мс против 18» на экране участника объяснялось прямо там, а не вопросом из зала,
**делаем** пометку `cold start` в UI.

`next-observe` 0.3.1 и `next-observer` 0.3.2 опубликованы.

- Агенты холодный старт учитывают с шага 25 (`coldStart` в `get_trace`, исключение из статистики) — человек в UI видел только цифру.
- Сводка трейса получает `coldStart`, если в трейсе есть холодный запрос (у трейса из браузера холодный — серверный спан внутри); `/api/traces/:id` помечает сам этот спан.
- UI: значок `cold start` у трейса в списке и в заголовке трейса, с подсказкой: первый запрос маршрута после старта сервера, в `next dev` включает компиляцию, агенты не учитывают его в латентности. В waterfall сразу видно, куда ушло время: пустой промежуток между `resolve page components` и `executing api route`.

### Гипотеза, которая не подтвердилась

На экране рядом с помеченным `GET /api/inventory/2` (699 мс) был такой же **без** пометки (721 мс): React в dev вызывает эффект дважды, два одинаковых запроса уходят разом. Предположили, что второй обрабатывается параллельно и ждёт ту же компиляцию, и ввели правило «начался, пока первый ещё шёл — тоже холодный». Проверка на сырых спанах: **нет** — Next держит второй запрос в очереди; его серверный спан начинается на +657 мс, когда первый закончился, и длится 104 мс; браузер ждал до начала серверного спана. По серверным данным он не холодный, правило к нему не применимо — откатили (вместе с тестом). Ожидание и так видно в waterfall: серверная полоса двойника начинается на +657 мс.

### Как тестировали

- Тест: в трейсе из браузера с холодным серверным спаном внутри — сводка с `coldStart`, у тёплого — без; `/api/traces/:id` по настоящему HTTP помечает **только** холодный спан. 202 теста. Мутации (2): список без пометки; все спаны помечены — падают тесты.
- В настоящем браузере на tarball 0.3.3 (свежий `next dev`): в списке `cold start` у первых `GET /product/[id]` (1.36 с) и `GET /api/inventory/2` (699 мс); в заголовке трейса — значок. Значок у строки waterfall обрезается в узкой колонке имени — опора на список и заголовок.

### Что узнали

- Гипотезу о поведении фреймворка проверяем на сырых данных до того, как писать правило: правило «по интуиции» было бы тихо неверным и для агентов (исключало бы запросы из латентности).

---

## Шаг 39. Повторная репетиция на опубликованных версиях

**Чтобы** убедиться, что четыре шага правок (36–38) ничего не сломали,
**прошли воркшоп ещё раз** как участник: чистый клон, `next-observe` 0.3.1 и `next-observer` 0.3.3 из npm, настоящая модель.

- Блоки 0 и 2: `doctor` зелёный, `init` → `npm run observe`. В браузере: подписи `GET /api/inventory/1`, `cold start` у первых запросов, шума npm нет; ушли со страницы через 1 с — оба запроса дошли вместе с браузерной частью.
- Догонялка `git checkout -B workshop block-4-agents` — одна строка вместо «detached HEAD».
- Блок 4: три вопроса — верно (checkout ×7.4 в `chargePayment`, `lib/payment.ts`; `checkInventory` 41.7%; N+1 в `listProducts`). **Детектор теперь сам поднял `high_latency: POST /api/checkout`**, агенты: «`chargePayment` ~99% времени, деплой v2» (на первой репетиции эту тревогу он пропускал).

### Находки

- **Теги держали в lock-файле `next-observe` 0.3.0.** Догнавший тегом получал клиент без исправлений шага 37, а сделавший `init` сам — 0.3.1. Пересобрали цепочку на текущем `master` магазина (уже с новым README): `block-2-init` — снова настоящей `init`; блоки 3 и 4 — тем же содержимым. Отличие от прежних тегов — только README и `next-observe ^0.3.1`. Проверка чистым клоном: у каждого тега 0.3.1, сборка и `doctor` проходят, `init` на старте = `block-2-init`. **Правило: после каждого выпуска `next-observe` до воркшопа — пересобирать теги.**
- **Четыре проактивных расследования на две проблемы.** На каждую сработали и правило по операции, и по всему приложению — в разные проверки, так что одно не гасит другое. Отчёты верные, но на сцене дублируются.
- Серверные спаны приходят пачкой раз в 5 с (умолчание OTel): открыть список сразу после клика — увидишь только браузерную часть, через секунды подтянется сервер. Объяснять на сцене или уменьшить задержку для dev.
- UI молча опрашивает остановленный обзервер (36 ошибок в консоли) — можно показывать «обзервер недоступен».

---

## Шаг 40. Одна проблема — одно расследование

**Чтобы** на сцене на две проблемы приходило два расследования, а не четыре,
**делаем** так, чтобы детектор не повторял уже объяснённую аномалию на другом уровне.

На повторной репетиции (шаг 39) на две проблемы пришло четыре проактивных расследования: каждую поймали и правило по операции (окно 30 с), и правило по всему приложению (10 с). Срабатывали они в **разные** проверки, а прежняя защита («аномалию операции не показываем, если в этой же проверке есть аномалия по приложению») действовала только внутри одной проверки.

- Детектор помнит отчёты в пределах cooldown. Аномалию **по приложению** не показываем, если **у всех** её операций-виновников уже была своя аномалия того же типа; аномалию **операции** — если недавняя аномалия по приложению уже назвала её виновником.
- Если по приложению виноваты две операции, а отчёт был только об одной, — аномалия по приложению остаётся: она говорит новое. После cooldown старый отчёт ничего больше не объясняет. «Тишина» не дедуплицируется.

### Как тестировали

- Тесты: операция → потом приложение (тот же виновник) — одно; приложение → потом операция — одно; новый виновник — приложение показывается; старый отчёт после cooldown не гасит; трафик репетиции на минуту — ровно две аномалии (`high_error_rate` инвентаря, `high_latency` checkout). 21 тест детектора. Мутации (6): без дедупликации; «хватит одного известного виновника»; операция никогда не гасится; без cooldown для дедупликации (сначала выжила — добавили тест на устаревание); отчёты не запоминаются; «тишина» всегда гасится — каждый раз падают тесты.
- E2E: tarball 0.3.4, Porto Shop v1 → v2 под `npm run load`, поток проактивных событий: **2 аномалии, 2 расследования** (на репетиции — 4).

---

## Шаг 41. Трейсы почти сразу после клика; «обзервер недоступен» в UI

**Чтобы** участник видел трейс сразу после клика, а открытая вкладка UI честно говорила, что обзервер остановлен,
**делаем** две маленькие правки из бэклога репетиции.

- **`next-observe` 0.3.2 — серверная пачка в dev раз в 1 с.** По умолчанию OTel отправляет раз в 5 с: в `next dev` это «кликнул — и секунды ждёшь серверную половину трейса». В проде остаются 5 с — меньше запросов. `serverBatchDelayMs()`; `register()` передаёт её каждому получателю.
- **`next-observer` 0.3.5 — баннер «обзервер недоступен».** UI раздаёт сам обзервер, так что это про вкладку, оставленную открытой, когда обзервер остановили (Ctrl+C, переключение v1 → v2): раньше она молча замирала с ошибками в консоли. Опрос `/health` раз в 2 с, без повторов; когда обзервер вернулся — баннер исчезает сам.

### Как тестировали

- `next-observe`: 64 теста — 1 с в development, 5 с иначе; `register()` передаёт задержку обоим получателям. Мутации (2): всегда 5 с; `register()` не передаёт — падают тесты.
- **Замер с контролем** на Porto Shop: через сколько после запроса серверный спан виден в обзервере. Опубликованный клиент 0.3.1 — 5.1 / 5.2 / 5.1 с; новый 0.3.2 — **1.2 / 1.2 / 0.6 с**.
- Баннер в настоящем браузере на tarball 0.3.5: UI открыт → обзервер остановлен → баннер; обзервер запущен снова → баннер исчез.

### Заметки

- Демо-данные: id трейсов — счётчик с ведущими нулями, и в списке (первые 16 символов) все выглядят как `0000000000000000`. Сделать демо-id случайными.
- Один раз снимок страницы показал адрес `/traces/0000…023d` без моего перехода; при повторном снимке — `/traces`. Не повторилось, причина не найдена.

---

## Шаг 42. «Это новое?» — агент ошибок видит историю ошибки

**Чтобы** на вопрос «эти ошибки принёс последний деплой?» агент отвечал фактами,
**делаем** историю сообщения об ошибке и сравнение версий для агента ошибок.

Между шагами: опубликованы `next-observe` 0.3.2 и `next-observer` 0.3.5; теги магазина пересобраны на 0.3.2 и проверены чистым клоном (правило шага 39).

- `get_errors`: у каждого частого сообщения — `firstSeenMinutesAgo`, `firstSeenVersion` и `seenInVersions` (в порядке деплоя). **По всем хранимым данным**, не только по окну `sinceMinutes`: деплой мог быть давно. Сообщение сравнивается точно и только в своей операции — у `POST /pay/refund` та же строка не попадает в историю `POST /pay`.
- Агенту ошибок добавлен `compare_versions` (значима ли разница доли ошибок — z-тест шага 30) и инструкция: сказать, новая ли ошибка.

### Как тестировали

- Демо: сообщение инвентаря — впервые в v1, есть в v1 и v2, первая встреча > 10 мин назад — **даже при окне 5 мин**. Ошибка только в v2 — `firstSeenVersion: v2`, `seenInVersions: [v2]`; одинаковое сообщение в операции с похожим именем не смешивается. С mock-моделью агент ошибок вызывает `compare_versions`. 210 тестов. Мутации (5): история только по окну; операции по подстроке смешиваются; самая поздняя вместо самой ранней; версии не в порядке деплоя; агенту не дали `compare_versions` (сначала выжила — добавили проверку вызова) — каждый раз падают тесты.
- Настоящая модель, Porto Shop v1 → v2 под нагрузкой, «Are the inventory errors new? Did the last deployment introduce them?» → «**не новые и не из-за последнего деплоя**: есть в v1 и v2; доля 27.5% → 10%, изменение незначимое (`errorRateChangeSignificant: false`); давняя проблема upstream в `lib/inventory.ts`».

---

## Шаг 43. Пароль на UI, API и чат обзервера

**Чтобы** обзервер можно было держать на публичном сервере (прод-демо блока 5),
**делаем** пароль для людей — UI, API запросов и чата.

`next-observer` 0.3.6 опубликован.

Начали писать инструкцию к прод-демо и сначала проверили, что защищает `--api-key`: **только приём трейсов** (без ключа — 401). UI, `/api/traces`, `/api/services` и **`/api/chat`** отвечали 200 без всякой проверки: любой, кто знает адрес, читает все трейсы и гоняет агентов — на сервере это токены Gemini за счёт владельца. README при этом обещал «x-api-key on ingest and API».

- **`--ui-password` / `OBSERVE_UI_PASSWORD`** — HTTP Basic Auth (браузер сам показывает окно входа, имя любое) на всё, кроме приёма `/v1/traces` (у него свой `x-api-key`) и `/health` (для проверок доступности). Сравнение без утечки по времени (sha256 + `timingSafeEqual`), только схема `Basic` и только форма `user:password`.
- Баннер: какие двери закрыты; если обзервер слушает не `127.0.0.1` и двери открыты — **WARNING** с подсказкой флага.
- README: исправлено описание ключа, раздел «On a server».

### Как тестировали

- По настоящему HTTP: без пароля UI, `/traces`, `/api/*` и чат (GET и POST) — 401 с `WWW-Authenticate: Basic`; с паролем (любое имя, пароль с `:` и пробелом) — 200; неверный пароль, другая схема с верными данными, «голый» пароль без `user:` — 401; `/health` открыт; приём — по `x-api-key`, пароль ему не подходит. Баннер: предупреждения на `0.0.0.0`, их нет на `127.0.0.1`. 216 тестов. Мутации (7): без проверки пароля; пароль с `:` ломается; заголовок без `user:` принимается; любая схема принимается; `/health` закрыт; нет предупреждения — каждый раз падают тесты (две сначала выжили — тесты не различали случаи, переписаны: другая схема с **верными** данными; пароль без двоеточия).
- В браузере на tarball 0.3.7 (`--host 0.0.0.0 --api-key … --ui-password …`): без пароля — 401; после входа — список трейсов (191), поток проактивных событий, вопрос в чате и ответ, 0 ошибок в консоли.

### Что узнали

- Проверка входа через `user:pass@host` в адресе ломает `fetch` на странице (браузер не строит запросы от URL с учётными данными) — UI показал «обзервер недоступен». Это артефакт способа проверки, не продукта: у человека после окна входа адрес чистый. Повторили с чистым адресом — всё работает.
- Прежде чем писать инструкцию «как развернуть», стоит проверить, что развёрнутое безопасно: так нашлась открытая дверь.

---

## Шаг 44. Инструкция к прод-демо блока 5 — с проверкой связки

**Чтобы** блок 5 (Vercel + свой сервер) не прогонялся впервые на сцене,
**делаем** инструкцию [`PROD_DEMO.md`](PROD_DEMO.md) и проверяем локально всё, что можно проверить в прод-режиме.

`next-observer` 0.3.7 (пароль на UI) опубликован.

- Связка как в проде, локально: магазин в состоянии финала + `npx next-observer init --proxy` (добавил **только** маршрут-прокси); `next build` **без** адресов; обзервер с `--api-key` и `--ui-password`, настоящая модель; `next start` v1 с `OBSERVE_ENDPOINT` + `OBSERVE_API_KEY` → нагрузка → «редеплой» v2 → нагрузка.
- Результат: серверные трейсы v1 → v2 и браузерные (через прокси, ключ добавляется на сервере); чат по паролю: «v1 → v2, `chargePayment` ×8.5, `lib/payment.ts`, внутри самой функции»; без пароля — 401.
- Нашлось для инструкции: обзервер берёт `observe.agents.ts` из своей папки — на сервере файла агентов участника нет, его надо положить рядом с обзервером. У браузерных спанов нет `service.version` (старый пункт бэклога) — сравнению деплоев не мешает.
- Риск Vercel «функция заморозилась до отправки спанов» — проверили по коду `@vercel/otel` 2.1.3: на старте корневого спана он регистрирует `waitUntil(… forceFlush())`, это отправляет все процессоры, включая наши. На настоящем Vercel не проверено — первый пункт пробного деплоя.
- В инструкции помечено, что проверено (✅), а что нет (⚠️): systemd, Caddy/HTTPS (Caddy локально не установлен — ставить софт без спроса не стали), Vercel, **Gemini с настоящим ключом в проекте ещё не прогонялся**. В конце — чек-лист пробного деплоя.

---

## Шаг 45. Версия у браузерных спанов; демо-id как настоящие

**Чтобы** браузерная часть трейса тоже знала, какой это деплой, а список демо-трейсов не выглядел как ряд нулей,
**делаем** две правки из бэклога.

- **`next-observe` 0.3.3:** `withObserve()` при сборке передаёт в бандл `OBSERVE_SERVICE_VERSION` (иначе `VERCEL_GIT_COMMIT_SHA`) — так же, как имя сервиса; клиент кладёт её в ресурс как `service.version`. Раньше у `…-browser` версий не было (`[]`) — видно было в прод-связке шага 44.
- **`next-observer` 0.3.8:** id демо-данных — детерминированный хеш от счётчика вместо счётчика с ведущими нулями: в списке трейсов все были `0000000000000000`. Воспроизводимость для тестов сохранена.

### Как тестировали

- `next-observe`: 66 тестов — версия в `env` сборки (из переменной, из SHA Vercel, из опции; нет — не задаётся), клиент берёт её. `next-observer`: демо-id — 32/16 hex, без нулевого префикса, уникальны, одинаковы при повторе. Мутации (4): версия не передаётся в бандл; нет SHA Vercel; клиент игнорирует версию; id снова с нулями — каждый раз падают тесты.
- Настоящая сборка Next: Porto Shop `dev:v2` с tarball 0.3.3, страница в браузере → `workshop-ai-observability-browser ['v2']` (подстановка `env` работает и для кода из `node_modules`).

---

## Шаг 46. Шум `next dev` (проверка версии в npm) — отбрасывать до отправки

**Чтобы** в списке трейсов и у агентов не было `fetch GET https://registry.npmjs.org/-/package/next/dist-tags` — на репетиции 3 он снова появился, хотя шаг 37 его «убрал»,
**делаем** фильтр спанов перед экспортом вместо `ignoreUrls`.

- **Почему шаг 37 не помог.** `next dev` проверяет свою версию один раз — когда к HMR подключается первый браузер. Кто трассирует этот fetch, зависит от момента: после `register()` это делает `@vercel/otel` (он выставляет `NEXT_OTEL_FETCH_DISABLED=1`), и `ignoreUrls` срабатывает. Но если открытая вкладка переподключается, пока сервер ещё стартует (рестарт v1 → v2 на репетиции), Next пишет спан **сам** — scope `next.js`, `AppRender.fetch`, — и `ignoreUrls` его не видит. Прежнее «исчезновение» было удачным таймингом.
- **`next-observe` 0.3.4:** `DropSpans` — обёртка над `BatchSpanProcessor` каждого адресата, `isDevNoise()` отбрасывает спаны с `http.url`/`url.full` на `https://registry.npmjs.org/` **только при `NODE_ENV=development`** (прод-приложение, которое само ходит в npm, — это его трафик). Неработающий `ignoreUrls` для npm убран.

### Как тестировали

- 68 юнит-тестов: `isDevNoise` (dev/prod, оба атрибута URL, чужие адреса), `DropSpans` пропускает остальные спаны и вызовы `forceFlush`/`shutdown`, `register()` оборачивает оба адресата. Мутации (4): фильтр и в проде; только `http.url`; `DropSpans` не отбрасывает; `register()` без обёртки — каждый раз падают тесты.
- e2e на копии магазина (`block-3-instrumentation`), свежий `.next`. Естественную гонку не поймали ни curl, ни браузером, ни ранним HMR-клиентом (Next проверяет версию лениво, один раз за процесс), поэтому в `instrumentation.ts` копии после `register()` создаётся спан с теми же scope, именем и атрибутами, что на репетиции, — он идёт через настоящий конвейер экспорта:
  - контроль, опубликованная `next-observe` 0.3.3: `GET /api/products` + `fetch GET https://registry.npmjs.org/…`;
  - tarball 0.3.4: только `GET /api/products` — обычные трейсы проходят, шум отброшен.

### Что узнали

- `@vercel/otel` выключает собственные fetch-спаны Next — пока он не зарегистрирован, Next трассирует сам. Фильтровать «по URL» надёжно только на выходе, а не в инструментации.
- Чтобы спровоцировать проверку версии без браузера: WebSocket на `/_next/hmr` (в Next 16 путь уже не `/_next/webpack-hmr`).

---

## Шаг 47. Тёмная тема UI — свой стиль по мотивам NestJS Observe

**Чтобы** UI обзервера выглядел как современный инструмент наблюдаемости (ориентир — [NestJS Observe](https://www.observe.nestjs.com/)), а на проекторе читались цифры,
**делаем** основу дизайна без новых функций: тему, шрифты, общие компоненты.

Что взяли у NestJS Observe: почти чёрный фон, моноширинные цифры, id и подписи, карточки с заголовком и счётчиком, строки «ключ ······ значение», индикатор LIVE. Что **не** взяли: их логотип и фирменный красный — у нас свой акцент.

- **Палитра (`next-observer` 0.3.9):** тёмная по умолчанию (`<html class="dark">`). Холодный почти чёрный фон, **циан** — «живое/наше» (LIVE, ссылки, полосы v1), **красный только для ошибок и critical**, **янтарный** для warning. Цвета сервисов в waterfall — из токенов `chart-*`, а не из жёстко заданных Tailwind-цветов.
- **Geist Mono** (`@fontsource-variable/geist-mono`) — длительности, id, заголовки таблиц, шаги агентов.
- Компоненты: `PageHeader` (заголовок + счётчик + строка о назначении страницы), `DetailRow` (строка с точками, валидная разметка `dl`), `LiveIndicator` в шапке (`LIVE · N spans` / `OFFLINE`, тот же запрос `/health`, что у баннера), стеклянная липкая шапка.
- Страницы: Traces — таблица в карточке; трейс — waterfall в карточке, детали спана строками с точками; чат — общий заголовок.
- Заодно исправили: длинный mock-отчёт без пробелов вылезал за карточку (`overflow-wrap: anywhere`); аномалия warning была красной, как critical.

### Как тестировали

- 217 юнит-тестов `next-observer` и typecheck UI. Шаг визуальный — мутации тут не про логику, поэтому проверка глазами и замерами в браузере.
- `collector --demo` из сборки → Traces, трейс с ошибкой, трейс checkout, чат с двумя проактивными расследованиями — скриншоты. Нашли и исправили по ходу: карточка waterfall растягивалась по высоте соседней колонки; полосы были слишком яркими и толстыми.
- Замеры в браузере: `scrollWidth ≤ clientWidth` у каждого отчёта, у страницы нет горизонтальной прокрутки, у шагов агентов шрифт `Geist Mono Variable`, у аномалий `data-severity="warning"` → янтарная рамка.
- Tarball `next-observer` через `npx --package=…tgz next-observer collector --demo`: фон `oklch(0.145 0.006 255)`, Geist Mono загружен, `LIVE · 479 spans`; коллектор остановлен → индикатор `OFFLINE` + баннер.

### Дальше по дизайну

Дашборд на `/` → баннер «похоже на регрессию» с кнопкой «Расследовать» → страница операции → собственное и полное время + критический путь в трейсе → ошибки-дефекты → «промпт для coding-агента».

---

## Шаг 48. Дашборд Overview — главная страница обзервера

**Чтобы** с первого взгляда было видно, всё ли в порядке (трафик, задержка, ошибки, какие маршруты медленные), а не листать список трейсов,
**делаем** страницу `/` по образцу NestJS Observe и API под неё.

- **`GET /api/overview?windowMs&service&toMs`** — одна чистая функция `computeOverview()` по спанам окна и окна перед ним:
  - запрос = серверный спан (как у детектора); класс по коду: 5xx (или ошибка без кода) — сбой сервера, 4xx — клиент, остальное — ок;
  - 30 корзин по времени: запросы по классам, AVG и P95 (пустая корзина — разрыв, а не ноль);
  - «since last period» — сравнение с окном той же длины перед текущим; не с чем сравнить → изменения нет (не «0%»);
  - холодные старты считаются в трафик, но **не** в задержку (как у агентов); маршрут, у которого были **только** холодные запросы, помечен `coldOnly` и стоит в «Slowest» после остальных — иначе в dev первым был бы `GET /_not-found` с 834 мс компиляции;
  - топ-5 «Slowest» (по P95) и «Busiest» (по числу вызовов, с долей).
  - Окно от 1 минуты до 24 часов, иначе 400; под `--ui-password` закрыт, как остальное API.
- **UI (`next-observer` 0.3.10):** пункт **Overview** в шапке, `/` больше не перенаправляет на Traces. Карточки Requests (столбики 2/3xx серые, 4xx янтарные, 5xx красные; запросов в секунду), Duration (P95 — площадь, AVG — пунктир), Errors (доля 5xx крупно + столбики), Slowest и Busiest — клик ведёт в Traces с фильтром по операции. Окно 5m / 15m / 1h / 24h и сервис — в URL. Графики свои (div + SVG), без библиотеки.

### Как тестировали

- 10 юнит-тестов `computeOverview` + эндпоинт (окно до `toMs`, холодный старт из хранилища, 400 на окно вне диапазона); `/api/overview` добавлен в тест пароля. Всего 227.
- Мутации (10): ошибка без кода → ок; 4xx → ок; не-серверные спаны считаются запросами; предыдущее окно перекрывает текущее; холодные в задержке; запрос ровно в `nowMs` без последней корзины; пустая корзина = 0; Busiest по P95; без пометки `coldOnly`; без её учёта в сортировке — **каждая** роняет тесты.
- Демо (`collector --demo`): виден скачок задержки v1 → v2 и всплески 5xx; переключение окна → `?window=5m`; клик по маршруту → `/traces?operation=POST /api/checkout`; горизонтальной прокрутки нет.
- **Настоящий Next:** Porto Shop с `next-observe` 0.3.4 → коллектор из ветки, 50 запросов + один 404: 404 попал в 4xx, падения inventory — в 5xx (32%), `/_not-found` внизу «Slowest» с «cold start only».
- Tarball: `/` и `/api/overview` отдаются.

---

## Шаг 49. Баннер «v2 looks like a regression» с кнопкой Investigate

**Чтобы** после деплоя не искать регрессию глазами, а сразу отдать её агентам,
**делаем** баннер на любой странице обзервера: измеренные числа от обзервера + одна кнопка, которая открывает чат с готовым вопросом. У NestJS Observe там «View releases» — у нас расследование.

- **`findRegression()`** (`src/debug/regression.ts`) — простые правила поверх готового `compareVersions`, без модели:
  - задержка: p95 вырос **в 2 раза и больше** *и* **на 100 мс и больше** (2 мс → 9 мс — это ×4.5 и ничья проблема);
  - ошибки: изменение значимо (z-тест из шага 30) *и* не меньше 10 процентных пунктов;
  - по 5+ запросов с каждой стороны, не только холодные старты;
  - называем **маршрут** (`POST /api/checkout`), а не функцию внутри (`chargePayment`) — функция и есть диагноз, это работа агентов; сбои важнее замедлений.
- **`GET /api/regression`** → `{ regression }` или `null`; в ответе готовый вопрос для агентов.
- **UI (`next-observer` 0.3.10, вместе с дашбордом):** карточка справа внизу: «v2 looks like a regression. Since v2 went out, p95 of POST /api/checkout moved from 320ms to 2.51s (×7.8)». **Investigate** → `/chat?ask=…`: чат отправляет вопрос один раз и убирает его из URL (перезагрузка не спросит повторно). **Dismiss** запоминается на вкладку для этой находки — другая регрессия покажется снова.

### Как тестировали

- 10 юнит-тестов (правила, фикстура магазина, эндпоинт) + `/api/regression` в тесте пароля; всего 237. Мутации (9): без порога «+100 мс», без порога «×2», без минимума запросов, холодные старты, без проверки значимости, округлённая разница, без предпочтения маршрута, сбои не важнее, версии перепутаны — каждая роняет тесты.
- **Тест нашёл ошибку:** `compareVersions` округляет разницу долей ошибок до одного знака (для агентов), и 2% → 8% превращалось в «0.1» и проходило порог. `findRegression` считает разницу сам.
- Браузер, демо, mock: баннер на Overview и Traces → Investigate → в чате ровно один вопрос, отчёт и карточки, URL `/chat` без `ask`, баннер скрыт и после перезагрузки; Dismiss скрывает.
- **Настоящая модель** (Kitana, `OBSERVE_AI=real`), вопрос баннера ×3: два раза верный ответ за 57 и 63 с — `chargePayment` в `lib/payment.ts`, 2490 из 2510 мс, v1 → v2; **один раз** шаги те же (compare_versions → search_traces → get_trace), но отчёт не пришёл за 180 с — «investigation took longer than 180s». Контроль (вопрос сценария 1) — 66 с. Разовый зависший вызов модели, не формулировка; в бэклог — повтор при таймауте шага.
- Tarball: `/api/regression` и баннер в сборке.

---

## Шаг 50. Страница операции: распределение задержек и «две скорости»

**Чтобы** про один маршрут или функцию было видно всё сразу — сколько вызовов, как распределена задержка, чем отличаются версии, — а не только p95,
**делаем** страницу `/operation?name=…` и API под неё.

- **`GET /api/operation?operation&service&windowMs`** (`src/collector/operation.ts`):
  - тот же расчёт, что у Overview, но по **точному имени** спана любого вида (`chargePayment` тоже операция);
  - **гистограмма** задержек: 24 равных столбца от 0 до p99 (один выброс в 30 с не сжимает всё остальное в первый столбец), более медленные — в последнем, их число в `overflow`;
  - **«две скорости»**: вызовы делятся на быструю и медленную группу там, где это объясняет больше всего разброса (2-means по логарифму задержки). Сообщаем, только если группы действительно разные: медианы отличаются в 3 раза и больше, в меньшей группе не меньше 10% и не меньше 3 вызовов;
  - таблица по версиям в порядке деплоя; холодные старты не входят в распределение, их число показано отдельно.
- **UI (`next-observer` 0.3.11):** Details (строки с точками + таблица версий), Latency distribution с маркерами median / p95 / p99 и подписью «TWO SPEEDS · 220ms (38%) and 1.62s (62%) · 7× apart», графики Calls и Duration, список трейсов с этой операцией. Сюда ведут: строки Slowest/Busiest на Overview, операция в баннере регрессии, ссылка «all calls of this operation →» в деталях спана. Таблица трейсов и выбор окна вынесены в общие компоненты.
- Дописан план: статус и порядок работ в начале `FEATURES.md` (маршрутизация traces уже есть; стоимость — в варианте «по маршрутам из трейсов»).

### Как тестировали

- 13 тестов (`latencyHistogram`, `findSpeeds`, `computeOperation`, эндпоинт, фикстура магазина) + `/api/operation` в тесте пароля; всего 250.
- Мутации (14): край гистограммы по максимуму вместо p99; overflow не считается; без последнего столбца; порог ×3 → ×2; без минимума доли; без минимума числа; линейная шкала вместо логарифма; поиск имени по подстроке; сервис игнорируется; холодные в гистограмме; версии не по порядку; фильтр операции в обзоре игнорируется; имя не обязательно — все роняют тесты. Две проверки («меньше 6 вызовов», «меньше 2») оказались лишними — тот же результат даёт условие «в меньшей группе ≥ 3» — и удалены. Для логарифма понадобился отдельный тест: 40 вызовов по 20 мс, 40 по 200 мс и пять по 5 с — на линейной шкале «медленной группой» стали бы пять выбросов.
- Браузер, демо: Overview → Slowest → страница `POST /api/checkout`: v1 220 мс / v2 1.62 с, «Two speeds», подписи маркеров не выходят за карточку (у правого края подпись разворачивается влево — сначала `p95` обрезалась); трейс → спан `chargePayment` → «all calls of this operation» → его страница; неизвестное имя → «No calls of this operation in the last 15m».
- Tarball: `/api/operation` и страница отдаются.

### Ревью перед мержем

Проверка в pre-commit на этом коммите не ответила (таймаут), поэтому запустили ревью отдельно — 6 замечаний, все исправлены:

- список трейсов искал операцию по **подстроке**, а числа считались по точному имени (`GET /api/products` тянул и `GET /api/products/[id]`) → `/api/traces?exactOperation=true`;
- окно списка бралось с часов браузера → берём `fromMs` из ответа коллектора;
- гистограмма для спанов в несколько микросекунд: края столбцов округлялись до 0.01 мс и совпадали → края с точностью до наносекунды, ключи по индексу, ось никогда не 0;
- подписи маркеров сравнивались с соседом, а не с последним оставленным (median 90, p95 95, p99 100 теряли и p95, и p99) → `histogramMarkers()` с тестом;
- `Math.max(...calls)` переполняет стек на 110–125 тыс. вызовов → `reduce`;
- без `service` числа смешивали сервисы, а подпись называла первый → `service: null`, если сервисов несколько.

Тест на 130 000 вызовов нашёл ещё и **квадратичную** группировку по версиям (копия массива на каждый вызов): 31 с вместо 0.3 с — на эндпоинте, который страница опрашивает каждые 2 с. Исправлено. Тестов стало 256; 5 мутаций на исправления — все пойманы своими тестами. В браузере: `GET /api/products` — 14 вызовов и 14 строк в списке.

---

## Шаг 51. Трейс: собственное время, критический путь, «этот вызов среди остальных»

**Чтобы** в трейсе было видно не только «что вызывалось», но и **где на самом деле ушло время** и нормален ли этот вызов,
**делаем** три вещи на странице трейса — все считаются в браузере из спанов трейса (`ui/src/lib/trace-analysis.ts`).

- **Собственное время** спана — его длительность минус время, покрытое прямыми детьми. Дети складываются как **интервалы** и обрезаются по родителю: два параллельных вызова не вычитаются дважды (их сумма бывает больше родителя), а дочерний спан, переживший родителя, не уводит его в минус.
- **Критический путь** — спаны, которые определили длительность: от конца спана идём назад и каждый раз берём ребёнка, который закончился последним перед текущей точкой. Ускорение любого другого спана трейс не ускорит. Кнопка **Critical path** приглушает остальные строки и показывает собственное время вместо полного.
- **Where the time went** — таблица по операциям: доля собственного времени, собственное, полное, число вызовов; клик ведёт на страницу операции. N+1 виден сразу: `db.query` — 5 вызовов, 75%.
- **Compared to other calls** — шкала с медианой и p95 этой операции за последний час (`/api/operation`), точка «этот вызов» и вердикт словами: медленнее 95% вызовов / типичный / быстрее половины. Показывается от 5 вызовов.
- В деталях спана — строка «own time».

### Как тестировали

- 14 тестов: параллельные и пересекающиеся дети, ребёнок дольше родителя, спан без родителя, несколько корней, путь «подготовка → два параллельных вызова», фоновая задача после конца родителя, сводка по операциям, вердикт на границах. Всего 270.
- Мутации (11): сумма вместо объединения интервалов; без обрезки по родителю; все дети на пути; курсор не сдвигается; дети по началу, а не по концу; первый корень вместо последнего; сервис не в ключе; сортировка по полному времени — пойманы. Две выжили и показали лишний код: проверку «родитель есть в трейсе» убрали. Вторую — `Math.max(0, …)` — сначала тоже убрали, потом **вернули**: 0.1 + 0.2 − 0.1 ≠ 0.2, собственное время выходило −4e-17 и печаталось бы как «-0µs»; на это теперь отдельный тест.
- Браузер, демо: медленный checkout — `chargePayment` 99% собственного времени, весь путь критический; каталог — `db.query` ×5 = 75%; подписи шкалы не выходят за карточку (p95 у правого края разворачивается влево).
- Проверка типов пакета поймала импорт без расширения в новом файле (сборка UI его прощает, тесты пакета — нет).
- Tarball: все три блока в сборке.

### Ревью перед мержем

Проверка в pre-commit снова не ответила, ревью запустили отдельно — 6 замечаний, все исправлены:

- доля собственного времени считалась от длительности трейса и при параллельных вызовах уходила за 100% (пять параллельных `db.query` по 80 мс в запросе на 100 мс — «400%») → доля **от всего собственного времени**, в сумме 100%;
- холодный старт получал вердикт «медленнее 95% вызовов», хотя холодные в выборку не входят → вместо вердикта пояснение «cold start — включает компиляцию маршрута»;
- «этот вызов» брался по первой строке waterfall, а критический путь — от корня, который заканчивается последним → одна функция `rootSpan()` для обоих;
- дочерний спан **другого сервиса** (браузер → сервер, разные часы), закончившийся на пару мс позже родителя, выбрасывал из пути всё серверное поддерево → для другого сервиса конец обрезается по родителю; внутри одного сервиса правило прежнее;
- окно сравнения было «последний час от сейчас» → **час вокруг самого трейса**, по его же меткам времени;
- трейс без корня (спан сам себе родитель, цикл) ронял страницу → пустой путь.

Тестов стало 273 (в файле 18); 7 мутаций на исправления — все пойманы. **Настоящий Next** (Porto Shop, `next-observe` 0.3.4): холодный `GET /api/products` — пояснение вместо вердикта, 47% собственного времени в `resolve page components` (компиляция); трейс «браузер → сервер» `GET /api/inventory/1` — все 5 спанов на критическом пути, доли в сумме 100%.

### Что узнали

- Агенты считают собственное время проще (минус **сумма** детей) — для параллельных вызовов занижают. В бэклог: тот же расчёт по интервалам в `get_trace`.
- «Типичный вызов» для checkout в 2.51 с — честно, но слабо: за час в выборке и v1, и v2, медиана 1.42 с. Сравнение внутри версии — отдельная идея.

---

## Шаг 52. Страница Errors: ошибки, сгруппированные в дефекты

**Чтобы** вместо сотни упавших запросов видеть «что именно сломано, с какой версии и что из-за этого падает»,
**делаем** страницу `/errors` и API под неё.

- **Дефект = где ошибка возникла + что она говорит** (`src/collector/defects.ts`):
  - упавшая функция помечает ошибкой и все спаны над собой, поэтому считаем **самый глубокий** упавший спан; маршрут, вернувший из-за него 500, идёт в «fails …»;
  - шаги самого Next («executing api route (app) …») дефектом не считаются — только если упали одни они;
  - сообщения группируются по **форме**: числа и длинные hex-id заменяются («Order 4127 not found» и «Order 9 not found» — один дефект), показывается последнее сообщение как есть и тип исключения;
  - история — по всему, что хранится: первое и последнее появление, версии в порядке деплоя; **new** — впервые появился в последней версии (и она не единственная);
  - в списке только то, что случалось в выбранном окне; сначала новые, затем по частоте.
- **`GET /api/defects?windowMs&service`**; под `--ui-password` закрыт.
- **UI (`next-observer` 0.3.13):** пункт **Errors** в шапке; карточка дефекта — пометка «NEW IN V2» или «seen in v1, v2», сообщение, операция и затронутые маршруты (ссылки на страницу операции), число и столбики по времени, первое/последнее появление, примеры трейсов, кнопка **Investigate** → чат с вопросом, в котором уже есть факты со страницы. С Overview — ссылка «view all →» в карточке Errors.

### Как тестировали

- 16 тестов (`computeDefects`, `messageShape`, эндпоинт, вопрос для агентов, фикстура магазина) + `/api/defects` в тесте пароля; всего 290.
- Мутации (21): каждый упавший спан — дефект; шаги Next как кандидаты; только-фреймворк скрыт; без формы сообщения; числа/hex не заменяются; операция или сервис не в ключе; фильтр сервиса; прекратившиеся дефекты в списке; счёт по всей истории; первое сообщение вместо последнего; «new» при единственной версии; «new» по последнему появлению; новые не первыми; версии не по порядку; без последней корзины; источник в «затронутых»; примеры от старых; `statusMessage` игнорируется — пойманы. Одна выжила: поиск родителя без учёта трейса — добавили тест на совпадение id спанов в двух трейсах (и он должен зависеть от порядка — первая версия теста мутацию не ловила).
- Браузер, демо: один дефект `inventory.check` — «seen in v1, v2», fails `GET /api/inventory/[id]`. Через OTLP добавили ошибку только в v2 (`applyCoupon`, `TypeError`) → встала первой с «NEW IN V2». Investigate → в чате один вопрос: «applyCoupon fails with "…". It first appeared in v2. Why does it fail, and is it new?».
- **Настоящая модель** (Kitana), вопрос про inventory: 50 с, `get_errors` → `get_trace` → `compare_versions`; ответ — «**not new**: firstSeenVersion v1, в обеих версиях, доля ровная (30.0% в v1, 29.2% в v2)». Это и есть четвёртый сценарий воркшопа «это новое?» — теперь в один клик.
- Tarball: `/api/defects` и страница отдаются.

### Ревью перед мержем

Проверка в pre-commit не ответила в третий раз подряд на большом коммите; отдельное ревью — 4 замечания, все исправлены:

- **UUID** в сообщении не считался одним id (короткие группы сохраняли буквы: `e29b` → `e<n>b`), каждое сообщение с новым UUID становилось отдельным дефектом → правило для UUID первым;
- «упали только шаги Next» решалось **на всё хранилище**: любая посторонняя ошибка скрывала такой дефект → решается по трейсу;
- **ложное «new»**: память вытесняет старые спаны, и когда v1-ошибки дефекта вытеснены, он выглядел бы новым в v2 — и агентам ушло бы «впервые появился в v2». Теперь у хранилища есть `isHistoryComplete()`; если что-то уже вытеснено, «new» ставится только при свидетельстве: та же операция ещё есть в записях предыдущей версии (и там так не падала);
- у затронутого маршрута терялся **его сервис** (ошибка браузер → сервер) → ссылка ведёт с правильным сервисом.

Тестов стало 295 (в файле 21); 9 мутаций на исправления — все пойманы.

### Что узнали

- В демо-данных нет ошибки, появившейся в v2, — пометку «new» пришлось проверять своим спаном. Для сценария «это новое?» в демо стоит добавить такую ошибку (в бэклог).

---

## Шаг 53. «Copy prompt» — готовый промпт для coding-агента

**Чтобы** от «обзервер нашёл проблему» до «агент в редакторе её чинит» был один клик, а не пересказ руками,
**делаем** кнопку **Copy prompt** в трёх местах: на странице трейса, в карточке дефекта и под отчётом агентов в чате.

- Промпт собирает **код, а не модель** (`ui/src/lib/agent-prompt.ts`) — только измеренное:
  - **трейс:** запрос, версия, id трейса, обычные медиана и p95; куда ушло собственное время (с файлами из `code.filepath`); ошибки там, где они брошены (тип, сообщение, верх стека — 8 строк); повторные вызовы (3+ одной операции под одним родителем — N+1); пометка холодного старта. Шаги самого Next не перечисляются;
  - **дефект:** сообщение, сколько раз, какие запросы из-за него падают, версии; для нового — задача «посмотри, что изменилось в v2»;
  - **отчёт:** сначала измеренные факты из карточек, потом диагноз агентов с пометкой «написано моделью — проверь по коду».
  - В начале каждого: «факты измерены, не додумывай сверх них»; в конце: «если код не объясняет числа — скажи, а не гадай».
- Копирование: `navigator.clipboard` есть только в защищённом контексте (https или localhost). Обзервер на дроплете по IP и http его не имеет — там запасной путь через временное поле.
- `next-observer` 0.3.14.

### Как тестировали

- 11 тестов на трёх трейсах фикстуры магазина (медленный checkout, N+1, ошибка), дефектах и отчёте; всего 306.
- Мутации (18): шаги Next в списке; только-фреймворк → пусто; стек целиком; ошибка повторена у вызывающих; порог N+1; без версии, без «обычно», без пометки холодного старта; задача «почему медленно» для упавшего запроса; файл не указан; деплой виноват всегда; затронутые запросы потеряны; факты не дедуплицированы; диагноз без фактов; отчёт не обрезан; карточка «(no message)» — все пойманы (три — после усиления тестов).
- Браузер, демо: кнопка на трейсе, в карточке дефекта (запасной путь копирования: текст скопирован, временное поле удалено) и под отчётом в чате.
- **По назначению:** промпт из трейса медленного checkout отдали Claude Code (`claude -p`, только чтение) в копии Porto Shop — за 17 с: «`lib/payment.ts:7-11`: в v2 `jitter(1400, 2500)` против `jitter(150, 300)` в v1», с объяснением, откуда медиана 1.42 с и p95 2.51 с. Файлы не тронуты.
- Tarball: кнопка и тексты в сборке.

### Что узнали

- В отчёт попадала карточка маршрута с сообщением «(no message)» — та самая «жертва» из находок репетиции 3. В промпт она больше не идёт; сама карточка в чате остаётся в бэклоге.
- На этом план «дизайн и функции по мотивам NestJS Observe» закрыт: тёмная тема, Overview, баннер регрессии, страница операции, трейс, Errors, промпт (шаги 47–53).

---

## Шаг 54. Зависший вызов модели — свой лимит и повтор

**Чтобы** один вызов модели, который не ответил, не съедал всё расследование (на шаге 49 один из трёх прогонов кончился «took longer than 180s»),
**делаем** лимит на **каждый** вызов модели и один повтор.

- Расследование — это 6–10 вызовов модели по 5–20 с. Лимит был один, на всё: 180 с. Зависал один вызов — пользователь ждал три минуты и получал «try a narrower question», хотя вопрос ни при чём.
- **`ResilientLlm`** (`src/agents/resilient-llm.ts`) — обёртка над любой моделью ADK: ждёт ответ `callTimeoutMs` (по умолчанию **90 с**, `OBSERVE_MODEL_TIMEOUT_MS`), затем бросает вызов и запускает его **ещё раз** (всего 2 попытки). Не ответил и второй — ошибка «the model did not answer within 90s (tried 2 times) — try again».
  - Лимит — на каждый кусок ответа, а не на весь ответ: длинный потоковый ответ не обрывается.
  - Если часть ответа уже ушла, повтора нет — он повторил бы сказанное.
  - Ошибки модели (квота, сеть) не повторяются — только молчание. Повтор при 429 — следующий шаг.
  - В терминале обзервера: `[next-observer] model call: no answer within 90s — trying again (2/2)`.
- Модель, заданная именем (Gemini), теперь превращается в экземпляр через `LLMRegistry` — чтобы лимит был у всех провайдеров одинаковый.
- Брошенному вызову передаётся сигнал отмены. Gemini в ADK его понимает; **Kitana сигнал игнорирует** — зависший CLI доживает в фоне, его поздний ответ отбрасывается. Поправим в Kitana (бэклог).
- `next-observer` 0.3.15.

### Как тестировали

- 10 тестов: обычный ответ (один вызов), зависание → повтор → ответ (сигнал первого вызова отменён), два зависания → ошибка с «tried 2 times», `attempts: 1`, зависание посреди ответа (без повтора), лимит на кусок, ошибка модели без повтора, отмена снаружи доходит до модели; через `createChatHandler` — зависание третьего вызова посреди расследования: отчёт приходит, в лог одна строка; значение из переменной окружения, отказ на «soon» и «0». Всего 316.
- Мутации (13): без повтора; повтор после части ответа; бесконечные повторы; сигнал не отменяется; отмена снаружи не связана; лимит на весь ответ; одна попытка по умолчанию; `onRetry` не вызывается; «tried N» потеряно; имя модели потеряно; модель не обёрнута; переменная окружения игнорируется или не проверяется — все пойманы.
- **Настоящая модель** (Kitana):
  - обычный прогон сценария 1 — 66 с, верный ответ, повторов 0 (обёртка ничего не меняет, когда всё хорошо);
  - с `OBSERVE_MODEL_TIMEOUT_MS=9000` (заведомо мало): 4 вызова перезапущены, расследование шло дальше; когда один вызов не ответил дважды — ошибка на 80-й секунде с понятным текстом, а не через 180 с. Брошенных процессов CLI после прогона не осталось.

### Ревью перед мержем

Проверка в pre-commit не ответила, отдельное ревью — 2 замечания, оба исправлены:

- лимит 60 с был **короче собственного лимита Kitana** на вызов CLI (120 с), а CLI-модель отвечает одним куском: здоровый, но долгий вызов (длинный отчёт, переход claude → codex внутри Kitana) был бы брошен, а рядом запущен дубль. Лимит на вызов теперь **90 с**, общий лимит расследования — **240 с** вместо 180 (чтобы у повтора было время);
- `OBSERVE_MODEL_TIMEOUT_MS` больше 2147483647 проходил проверку, но `setTimeout` молча превращает такую задержку в 1 мс — каждый вызов «не успевал». Теперь отказ при старте.
- Заодно: после отмены вызова снаружи повтора нет — отвечать уже некому.

Тестов стало 317; 4 мутации на исправления — все пойманы.

### Что узнали

- В интерфейсе чата повтор не виден — только в терминале. Если на репетиции это будет мешать, добавим строку в шаги расследования.

---

## Шаг 55. Gemini: первый настоящий прогон — и он не работал вовсе

**Чтобы** прод-демо на Gemini не упало на сцене (ошибка 429 на бесплатном тарифе, план шага — «повтор и понятное сообщение»),
**делаем** первый в проекте прогон с настоящим ключом Gemini. Он нашёл больше, чем искали.

### Что нашли

1. **Gemini с нашими инструментами не работал никогда.** Параметр `sinceMinutes` был описан как `z.number().positive()` — в схеме инструмента это поле `exclusiveMinimum`, которого API Gemini не знает: **400 на каждый запрос каждого специалиста**. ADK проглатывает ошибку внутри специалиста (агент как инструмент), оркестратор получает `{"result":""}` и уверенно пишет «специалисты не вернули данных». Kitana схему в API не отправляет (инструменты идут текстовым протоколом) — поэтому за 54 шага этого никто не видел.
2. **Ключ без кредитов** отвечает не 429, а **402** `RESOURCE_EXHAUSTED` («prepayment credits are depleted») — повторять бесполезно.
3. **Настоящий 429** на бесплатном тарифе: «limit: 5» запросов в минуту на `gemini-flash-latest`, «retry in 52s»; расследование делает 7–12 вызовов.
4. Настоящие **503** («overloaded») тоже случаются.

### Что сделали (`next-observer` 0.3.16)

- Схема: убрали `.positive()`; ноль и отрицательное `sinceMinutes` от модели запрос трактует как «не задано». **Тест-сторож**: у всех инструментов всех агентов — только поля, которые есть в `Schema` API Gemini.
- **Проглоченная ошибка специалистов больше не выглядит как «данных нет»:** если все специалисты вернули пусто — в чат уходит ошибка, а настоящая причина печатается в терминале обзервера (`[next-observer] model error: …`).
- `ResilientLlm` (шаг 54) теперь понимает ошибки провайдера (`src/agents/model-errors.ts`):
  - **429 и 5xx — подождать и повторить** (до 3 вызовов). Ждём столько, сколько просит провайдер (`RetryInfo` или «retry in N s» в тексте), иначе 2 с и 6 с; ждать больше 60 с (суточная квота — часы) бессмысленно — ошибка сразу;
  - **402, 401/403, 404, 400 — не повторять, объяснить**: «на счёте нет кредитов — пополните или возьмите другой ключ», «проверьте GEMINI_API_KEY», «проверьте GEMINI_MODEL», «это ошибка в next-observer или своём специалисте»; затем дословно текст провайдера;
  - зависания и ошибки провайдера считаются отдельно; после начатого ответа повтора нет.

### Как тестировали

- 22 новых теста (`model-errors`, `gemini-compat`); всего 338. В их числе **настоящий клиент ADK Gemini против локальной имитации API** (`GOOGLE_GEMINI_BASE_URL`): 429, 429, 200 → ответ получен, ждали 1 с и 1 с; 402 → объяснение, один запрос.
- Мутации (29): нет повтора; повтор всего подряд; без предела попыток и ожидания; задержка провайдера игнорируется; без паузы; повтор «съедает» попытку на зависание; ошибка без статуса обёрнута; сырой текст вместо объяснения; повтор после части ответа; 402 как временная; `RetryInfo` и текстовая подсказка; `.positive()` возвращён; пустые специалисты не замечены / любой пустой — фатален; неположительное `sinceMinutes`; ошибки не в терминале; 400 без объяснения — все пойманы (две — после добавления тестов).
- **Настоящий Gemini, `gemini-flash-lite-latest`, демо-данные — все четыре сценария верно:**
  - checkout — 10 с: регрессия v1 → v2 (p95 320 мс → 2510 мс), `chargePayment` в `lib/payment.ts`;
  - 500 на товарах — 5 с: `inventory.check`, «Inventory service timeout», не новая;
  - каталог — 6 с: N+1, `db.query` ×5, 90 из 120 мс;
  - «это новое?» — 71 с, из них **65 с ожидания настоящих 429** (обзервер ждал 6 с и 59 с, как просил Gemini) — и довёл до верного отчёта.
- Ключ без кредитов → в чате: «the account has no credits left. Top up the account or use another API key…».
- Обзервер + имитация API: в терминале две строки «rate limit reached (429), waiting 2s», запросы в :39, :41, :43, отчёт пришёл.

### Что узнали

- **Проверять надо на том провайдере, на котором будет демо.** Mock и Kitana прошли 54 шага; Gemini упал на первом запросе.
- Gemini быстрее Kitana через CLI примерно в 6–10 раз (5–10 с против минуты), но бесплатный тариф ограничивает запросы в минуту — для сцены нужен ключ с оплатой (записано в `PROD_DEMO.md`).
- Ожидание лимита в интерфейсе чата не видно (только в терминале) — при 59 с паузы это уже заметно. В бэклог.

---

## Шаг 56. Воркшоп без Wi-Fi

**Чтобы** плохой Wi-Fi на площадке не остановил блок 2 и догоняющих,
**делаем** так, чтобы после домашней подготовки (`npm install` + `npm run doctor`) сеть была не нужна вовсе, — и проверяем это с отключённой сетью.

### Что выяснили (npm отрезан от сети мёртвым прокси, отдельный чистый кэш)

- `npx next-observer …` — работает: обзервер в кэше после doctor. Когда сети нет, npm сам берёт устаревший кэш.
- **`npx next-observer init` — создаёт файлы, но `next-observe` не ставит** (и выходит с кодом 0): приложение потом не запустится. Причина: `npm install next-observe` без записи в lock-файле должен узнать у реестра, какие версии есть у пакета и его зависимостей, — этих сведений в кэше не было.
- **Догон** (`git checkout -B workshop block-4-agents && npm install`) — падает: файлов пакетов, которые добавляют блоки, в кэше нет.

### Что сделали

- **Porto Shop, `npm run doctor`** — новая проверка «the blocks work without Wi-Fi»: во временной папке (удаляется) делает то же, что `init` (`npm install` добавляемых пакетов от стартового состояния — кэшируются сведения о версиях), и ставит точное дерево последнего блока (`npm ci` по его lock-файлу — кэшируются все файлы пакетов). +40 с к doctor. Любая неожиданность (нет временной папки, повреждён тег) — строка отчёта, а не падение.
- **`next-observer` 0.3.17:** `init` ставит `next-observe` с `--prefer-offline` (npm, pnpm, bun; не yarn — berry на флаге падает), а если не вышло — **один раз повторяет без флага**. Скрипт `observe`, который пишет `init`, и скрипт `observer` магазина запускают обзервер из кэша.
- README магазина: подготовка — две команды, `npm install` и `npm run doctor`.

### Флаг `--prefer-offline` — не бесплатный

Во время работы вышел `next-observer` 0.3.16, и `npx --yes --prefer-offline next-observer@^0.3` упал: «No matching version found for next-observer@0.3.16» — в кэше оказались сведения о пакете разной свежести. Без флага та же команда прошла. Поэтому:

- **doctor ходит в сеть без флага** — он запускается дома и должен забрать свежую версию обзервера (иначе участники не получат исправление последней минуты);
- `init` не должен падать из-за самого флага — отсюда повтор без него;
- флаг остался только там, где сеть — риск: в скриптах запуска на площадке.

### Как тестировали

- `next-observer`: 343 теста; новые — `installArgs` по менеджерам пакетов, повтор установки (успех со второй попытки; обе неудачны — ручной шаг и не больше двух попыток; у yarn повтора нет). Мутации (7): флаг и для yarn; флага нет; скрипт без флага; CLI не использует `installArgs`; нет повтора; повтор при одинаковой команде; повтор с тем же флагом — все пойманы.
- **Офлайн-сценарий целиком** (чистый кэш → «дома»: `npm install`, `npm run doctor` → «площадка»: npm за мёртвым прокси):
  - `npx next-observer init` (опубликованный) и `init` из ветки — `next-observe` 0.3.4 установлен, `next build` проходит;
  - догон до `block-4-agents` + `npm install` — проходит;
  - запуск обзервера — проходит;
  - **контроль:** без doctor (пустой кэш) `init` пакет не ставит — проверка различает.
- Проверка проверки: незакэшированный пакет под той же имитацией падает с `ECONNREFUSED`. Первая попытка имитировать «устаревший кэш» через `prefer-online` оказалась нечестной (перебивала флаг в командах) — заменена настоящим ожиданием 6 минут; оно показало, что при отсутствии сети npm отдаёт устаревшее сам.
- pre-commit ревью магазина заблокировало первый вариант doctor (исключение без отчёта при недоступной временной папке) — исправлено, проверено с `TMPDIR` на несуществующую папку.

### Что узнали

- «Положить в кэш» — это две разные вещи: файлы пакетов и сведения о версиях. `npm ci` даёт только первое.
- `init` выходит с кодом 0, даже когда установка не удалась (пишет «manual»). Для воркшопа это ловушка — в бэклог.

---

## Шаг 57. В демо-данных — ошибка, появившаяся в v2; собственное время у агентов как в UI

**Чтобы** в `--demo` были видны пометка «NEW IN V2» на странице Errors и сценарий «это новое?» с ответом «да»,
**делаем** в демо-магазине новый баг версии v2.

- **Сценарий:** v2 добавила отправку чека после оплаты — `sendReceiptEmail` (`lib/email.ts`), без ожидания результата: стартует до ответа, заканчивается после него. Для гостевого заказа (каждый шестой) падает с `TypeError: Cannot read properties of undefined (reading 'email')`. Запрос при этом отвечает 200.
- **Почему так, а не отдельный падающий маршрут:** лишние 5xx подняли бы общую долю ошибок до порога детектора (20% за 10 с) — в демо появилась бы третья тревога, а отрепетированные три сценария поплыли бы. Фоновая функция запросы не роняет: детектор, Overview и баннер регрессии не меняются, дефект виден только как дефект.
- **Собственное время у агентов** (`get_trace`) считалось как «минус сумма детей»: фоновый ребёнок, переживший родителя, обнулял его время. Теперь — по интервалам с обрезкой по родителю, как на странице трейса (пункт бэклога с шага 51).
- `next-observer` 0.3.18.

### Как тестировали

- Сценарий изменился — 5 из 347 тестов это заметили; каждое ожидание пересмотрено отдельно: два теста про «первую упавшую трассу» уточнены до inventory, списки ошибок и трейс checkout дополнены новой функцией, тест дефектов магазина теперь ждёт два дефекта (новый — первым). Всего 346.
- Новые тесты: письмо есть только в v2, падают 5 из 30, запрос при этом 200, письмо начинается до ответа и кончается после; в живом трафике падает каждый 6-й тик, упавших запросов кроме inventory нет; собственное время при параллельных и «переживших» детях.
- Мутации (8): письмо и в v1; никогда не падает; роняет и запрос; в живом трафике не падает; письмо ждут (кончается до ответа); сумма вместо интервалов; без обрезки по родителю — все пойманы (одна — после добавления теста).
- Демо 45 с: дефекты — `sendReceiptEmail` (new, v2) и `inventory.check` (old, v1+v2); баннер по-прежнему `POST /api/checkout` ×7.8; доля ошибок запросов 13%, как раньше; тревоги детектора те же две (медленные запросы, ошибки inventory).
- Браузер: в трейсе checkout письмо видно, приглушено при «Critical path» (на длительность не влияет); собственное время шага Next — 7 мс и в UI, и у агентов.
- **Настоящая модель** (Kitana): «500 на товарах» — по-прежнему inventory, «pre-existing, v1» (59 с; в карточках добавилась `sendReceiptEmail`); вопрос про новый дефект — «**new**, exclusively in v2, `lib/email.ts`» (60 с).

---

## Шаг 58. Два пакета и два «агента» — явно, со скриншотами

**Чтобы** по странице пакета на npm было понятно, что это и зачем (автор сам запутался: «`next-observer` — это только агент? а почему тогда он стартует сервер?»),
**делаем** первый экран обоих README про разницу пакетов и вводим два термина.

- **Термины** (записаны и в `CLAUDE.md`, раздел «Words»):
  - **APM-агент** = `next-observe`: библиотека в приложении, собирает телеметрию и отправляет. AI в ней нет.
  - **AI-агенты** = ADK-агенты внутри `next-observer`: модели с инструментами, которые расследуют. В приложении не работают.
  - **наблюдатель (observer)** = `next-observer` целиком: сервер (коллектор), UI, детектор и AI-агенты.
  - Голое слово «агент» там, где его можно понять двояко, не пишем.
- **Оба README** начинаются одинаковым блоком «Two packages, one letter apart»: таблица (что это, где работает, что делает, есть ли AI), схема «приложение → трейсы → наблюдатель», абзац про два значения слова «agent».
- **`next-observer`:** раздел «What you get» со скриншотами — Overview с баннером регрессии, расследование в чате, Errors с «NEW IN V2», трейс с критическим путём, страница операции с «two speeds»; Copy prompt. README отставал на 11 шагов (47–57). Объяснено, что `collector` — это и есть сервер, а `dev` лишь запускает рядом `next dev` приложения. Раздел моделей: 7–12 вызовов на расследование, повторы, лимиты бесплатного тарифа; `OBSERVE_MODEL_TIMEOUT_MS` в таблице.
- **`next-observe`:** «The APM agent for Next.js», что именно собирает, и что AI-агентов в нём нет.
- Описания (`description`) и ключевые слова обоих пакетов — те же термины. Версии: `next-observer` 0.3.19, `next-observe` 0.3.5 (страница npm обновляется только с публикацией).
- Скриншоты — в `docs/screenshots`, в README по прямым ссылкам GitHub (репозиторий публичный): видны и на npm, и на GitHub, в пакеты не входят.

### Как тестировали

- Скриншоты сняты с `collector --demo` из текущей сборки, **с настоящей моделью** (Kitana): в чате — настоящее расследование, начатое детектором (регрессия v1 → v2, `chargePayment`, `lib/payment.ts`), а не заглушка `[mock]`.
- Оба README отрисованы через GitHub Markdown API: 4 таблицы в каждом, 5 и 1 картинка, ни одной «рассыпавшейся» таблицы.
- Утверждения сверены с кодом: 90 с на вызов модели, ожидание лимита до 60 с, четыре находки в `--demo`.
- `npm pack --dry-run`: README входит в оба пакета; размер пакетов не вырос (картинки снаружи). Тесты без изменений: 346 и 68.

### Что узнали

- Имена, различающиеся одной буквой, требуют объяснения в первой строке — и одного и того же в обоих местах.
- Картинки появятся на npm только после мержа в `master` (ссылки ведут на него) и публикации.

---

## Дальше

- [ ] DevTools-хук (bippy) в `instrumentation-client.ts`: `actualDuration` всех компонентов в profiling-сборке.
- [ ] Связать `documentLoad` с серверным трейсом через `traceparent` в HTML.
- [x] `withObserve(nextConfig)`, шаг 5
- [x] `next-observe/server` и `next-observe/client`, шаг 6
- [x] `service.version` у браузерных спанов, шаг 45
- [x] Коллектор + хранилище + API запросов в пакете, шаг 7
- [x] `nxo dev` / `nxo collector`, шаг 8
- [x] UI трейсов: список + waterfall, шаг 9
- [x] Проверка ADK 2.x + Kitana (Claude CLI), шаг 10
- [x] Инструменты агентов поверх хранилища, шаг 11
- [x] Детектор: окно 30 с для правила по операции, шаг 36
- [x] После репетиции: шум npm от `next dev`, подписи браузерных трейсов, `git checkout -B workshop`, шапка UI, `nxo`; потеря браузерных спанов при уходе со страницы, шаг 37
- [x] Пометка холодного старта в UI, шаг 38
- [x] `next-observe` 0.3.1 и `next-observer` 0.3.2 опубликованы (шаг 38)
- [x] `next-observer` 0.3.3 опубликован; повторная репетиция, теги пересобраны на `next-observe` 0.3.1, шаг 39
- [x] Одна проблема — одно расследование (дедупликация аномалий между уровнями), шаг 40
- [x] Серверная пачка в dev — 1 с, шаг 41
- [x] UI: баннер «обзервер недоступен», шаг 41
- [x] Демо-данные: id как настоящие, шаг 45
- [x] `next-observe` 0.3.3 и `next-observer` 0.3.8 опубликованы, теги пересобраны (шаг 45)
- [x] `next-observe` 0.3.4 опубликован, теги магазина пересобраны (шаг 46)
- [x] `next-observer` 0.3.9 опубликован (тёмная тема, шаг 47)
- [x] `next-observer` 0.3.10 опубликован (дашборд и баннер регрессии, шаги 48–49)
- [x] Страница операции, шаг 50
- [x] `next-observer` 0.3.11 опубликован (страница операции, шаг 50)
- [x] `next-observer` 0.3.12 опубликован (трейс, шаг 51)
- [x] Трейс: собственное время, критический путь, сравнение с другими вызовами, шаг 51 (`next-observer` 0.3.12)
- [x] `get_trace`: собственное время по интервалам, как в UI, шаг 57
- [x] `next-observer` 0.3.18 опубликован (демо и собственное время, шаг 57)
- [x] README обоих пакетов: два пакета, APM-агент и AI-агенты, скриншоты, шаг 58
- [ ] Опубликовать `next-observer` 0.3.19 и `next-observe` 0.3.5 (README, шаг 58); после — пересобрать теги магазина.
- [ ] README магазина и план воркшопа: те же термины (APM-агент / AI-агенты).
- [x] Страница Errors: дефекты, шаг 52
- [x] `next-observer` 0.3.13 опубликован (страница Errors, шаг 52)
- [x] Демо-данные: ошибка только в v2 (`sendReceiptEmail`), шаг 57
- [x] «Copy prompt» для coding-агента, шаг 53 — план дизайна (шаги 47–53) закрыт
- [x] `next-observer` 0.3.14 опубликован (Copy prompt, шаг 53)
- [ ] Стоимость по маршрутам из трейсов (`--monthly-usd`) — см. статус в `FEATURES.md`; до воркшопа, если останется время.
- [ ] После воркшопа: логи с привязкой к трейсу, метрики рантайма (`FEATURES.md`).
- [x] Повтор зависшего вызова модели, шаг 54
- [x] `next-observer` 0.3.15 опубликован (повтор зависшего вызова, шаг 54)
- [x] Gemini: работает с нашими инструментами, 429/5xx — повтор, 402/401/404 — объяснение, шаг 55
- [x] `next-observer` 0.3.16 опубликован (Gemini, шаг 55)
- [x] Воркшоп без Wi-Fi: doctor кэширует блоки, init ставит из кэша с повтором, шаг 56
- [x] `next-observer` 0.3.17 опубликован (init из кэша, шаг 56)
- [ ] Смержить PR магазина №8 (doctor и офлайн) и **пересобрать теги** (изменится master).
- [ ] `init`: ненулевой код выхода, когда `next-observe` установить не удалось.
- [ ] Чат: показывать «ждём лимит модели, N с» в шагах расследования (сейчас только в терминале).
- [ ] Kitana: учитывать `abortSignal` в `generateContentAsync` (убивать процесс CLI) — тогда брошенный вызов действительно прерывается.
- [x] `next-observe` 0.3.2 и `next-observer` 0.3.5 опубликованы, теги пересобраны (шаг 42)
- [x] `next-observer` 0.3.6 опубликован (шаг 43)
- [x] Пароль на UI/API/чат (`--ui-password`), шаг 43
- [x] `next-observer` 0.3.7 опубликован; инструкция к прод-демо `PROD_DEMO.md`, шаг 44
- [ ] Пробный прод-деплой по чек-листу `PROD_DEMO.md` (сервер, Gemini, Vercel, детектор).
- [x] `service.version` у браузерных спанов, шаг 45
- [ ] Перед воркшопом: после каждого выпуска `next-observe` пересобрать теги магазина.
- [x] `next-observe/agents`: оркестратор + 3 специалиста, `getModel()`, `OBSERVE_AI=mock|real`, шаг 12
- [ ] `OBSERVE_AI=record|replay` для демо без сети.
- [x] Kitana: английский протокол инструментов (0.1.10), шаг 15
- [x] `next-observe`: Kitana `^0.1.10` в dev и peer, шаг 15
- [x] Чат: `/api/chat` (поток NDJSON) + живые шаги + страница `/chat`, шаг 13
- [x] Карточки-доказательства в чате (код, не модель), шаг 14
- [x] Память диалога через сессии ADK, шаг 16
- [x] Живой `--demo`: трафик v2 каждые 2 с, детектор срабатывает сам, шаг 32
- [x] Детектор аномалий + проактивные расследования (SSE), шаг 17
- [x] «Это новое?»: история сообщения в `get_errors`, `compare_versions` агенту ошибок, шаг 42
- [ ] Демо-данные: сообщение об ошибке на корневых спанах (сейчас «(no message)»).
- [x] Инструкция: на вопрос «где время» открывать трейс, шаг 14
- [x] Стартовое приложение Porto Shop (локально, ветка `WOR-…`), шаг 18
- [x] Детектор: правило по каждой операции, шаг 19
- [x] Битые вызовы инструментов: Kitana 0.1.11 + защита в `next-observe`, шаг 19
- [x] Kitana 0.1.11 опубликована, в `next-observe` поднята (шаг 22); Porto Shop — вместе с переходом на `next-observe` из npm.
- [x] Карточки: не дублировать внутренние спаны Next (`executing api route …`), шаг 22
- [x] Обзервер — отдельный пакет `nxo` (`npx nxo dev`), в приложении только `next-observe`, шаг 23
- [x] `next-observe` 0.2.0 опубликован, 0.1.0 deprecated; `nxo` отклонён npm → `next-observer`, шаг 24
- [x] `next-observer` 0.1.0 и `next-observe` 0.2.1 опубликованы, 0.2.0 deprecated; Porto Shop без ADK, на GitHub (шаг 25)
- [ ] Kitana: обновить `@anthropic-ai/sdk` в `@kitana-sdk/core` (0.30.1).
- [x] Холодный старт не регрессия: `service.instance.id`, исключение из латентности и детектора, шаг 25
- [x] Карточки регрессий без шума: z-тест для доли ошибок, +50 мс к порогу латентности, шаг 30
- [x] `next-observer` 0.1.1 и `next-observe` 0.2.2 опубликованы, Porto Shop PR #1 (шаг 26)
- [x] `next-observe` готов к публикации (0.1.0), шаг 20
- [x] `next-observe` 0.1.0 опубликован, Porto Shop на нём (шаг 23)
- [x] Репозиторий `workshop-ai-observability` на GitHub (шаг 25)
- [x] Porto Shop: старт на `master`, решения — теги `block-3-instrumentation`, `block-4-agents`, шаг 33
- [x] Сервер: стандартные `OTEL_EXPORTER_OTLP_*` (URL, заголовки, протокол), шаг 26
- [x] Браузерный прокси: необязательный маршрут `next-observe/proxy` (адрес и заголовки при запуске), шаг 27
- [x] Несколько получателей трейсов (обзервер + OTel-бэкенд, `destinations`), шаг 28
- [x] Обзервер принимает OTLP protobuf и gzip, шаг 29
- [x] `next-observe` 0.3.0 и `next-observer` 0.2.0 опубликованы; Porto Shop на них (шаг 30)
- [x] `next-observer` 0.2.1 опубликован (шаг 31)
- [x] `compare_versions` после выхода предыдущей версии из окна, шаг 31
- [x] `next-observer` 0.2.2 опубликован (шаг 32)
- [x] `next-observer` 0.2.3 опубликован (шаг 33)
- [ ] UI: страница операций (p50/p95/p99, error rate) из `/api/operations`.
- [ ] Разобраться с зависанием `nxo` при остановке, если повторится (см. шаг 9).
- [ ] Хранилище `node:sqlite` (данные переживают перезапуск).
- [x] `npx next-observer init`: подключение одной командой, шаг 34
- [x] `next-observer` 0.3.0 опубликован; Porto Shop: старт без телеметрии, блок 2 — `init`, шаг 35
- [x] `npm run doctor` в Porto Shop, шаг 35
- [x] Свои специалисты проекта: `observe.agents.ts`, `defineSpecialist`, шаг 21
- [x] Фолбэк по имени сервиса в инструментах, шаг 21
- [ ] Porto Shop: пример `observe.agents.ts` для блока воркшопа «свой агент» (в ветке-решении, не в стартовой).
- [ ] Свои инструменты проекта (`defineTool`) — если специалистам участников не хватит шести встроенных.
