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

## Дальше

- [ ] DevTools-хук (bippy) в `instrumentation-client.ts`: `actualDuration` всех компонентов в profiling-сборке.
- [ ] Связать `documentLoad` с серверным трейсом через `traceparent` в HTML.
- [x] `withObserve(nextConfig)`, шаг 5
- [x] `next-observe/server` и `next-observe/client`, шаг 6
- [ ] `service.version` у браузерных спанов.
- [x] Коллектор + хранилище + API запросов в пакете, шаг 7
- [x] `nxo dev` / `nxo collector`, шаг 8
- [x] UI трейсов: список + waterfall, шаг 9
- [x] Проверка ADK 2.x + Kitana (Claude CLI), шаг 10
- [x] Инструменты агентов поверх хранилища, шаг 11
- [ ] Шум для агентов: dev-запрос Next к registry.npmjs.org, холодная компиляция, флаг `lowSample`, имя браузерного корня.
- [x] `next-observe/agents`: оркестратор + 3 специалиста, `getModel()`, `OBSERVE_AI=mock|real`, шаг 12
- [ ] `OBSERVE_AI=record|replay` для демо без сети.
- [x] Kitana: английский протокол инструментов (0.1.10), шаг 15
- [x] `next-observe`: Kitana `^0.1.10` в dev и peer, шаг 15
- [x] Чат: `/api/chat` (поток NDJSON) + живые шаги + страница `/chat`, шаг 13
- [x] Карточки-доказательства в чате (код, не модель), шаг 14
- [ ] Память диалога в чате: встречные вопросы агента («want me to…?») сейчас некуда продолжить.
- [ ] `--demo`: подливать данные, чтобы демо не «замолкало» через 2 минуты.
- [x] Инструкция: на вопрос «где время» открывать трейс, шаг 14
- [ ] UI: страница операций (p50/p95/p99, error rate) из `/api/operations`.
- [ ] Разобраться с зависанием `nxo` при остановке, если повторится (см. шаг 9).
- [ ] Хранилище `node:sqlite` (данные переживают перезапуск).
- [ ] `npx next-observe init`: подключение одной командой.
