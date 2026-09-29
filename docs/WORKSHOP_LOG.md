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

## Дальше

- [ ] DevTools-хук (bippy) в `instrumentation-client.ts`: `actualDuration` всех компонентов в profiling-сборке.
- [ ] Связать `documentLoad` с серверным трейсом через `traceparent` в HTML.
- [x] `withObserve(nextConfig)`, шаг 5
- [x] `next-observe/server` и `next-observe/client`, шаг 6
- [ ] `service.version` у браузерных спанов.
- [x] Коллектор + хранилище + API запросов в пакете, шаг 7
- [x] `nxo dev` / `nxo collector`, шаг 8
- [ ] UI трейсов (статический SPA из коллектора): список + waterfall.
- [ ] Хранилище `node:sqlite` (данные переживают перезапуск).
- [ ] `npx next-observe init`: подключение одной командой.
