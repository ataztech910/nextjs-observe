// Generated from talk Markdown, introduction, measurement cards and mini-examples. Edit sources, then regenerate.
import type { Deck } from "./types";
import speakerPhoto from "../assets/about/me.jpg?inline";
import communityPhoto from "../assets/about/gdg-linz.jpg?inline";
import interactionCard from "../assets/measurements/A-interaction.png?inline";
import startupCard from "../assets/measurements/B-startup.png?inline";
import visibleCard from "../assets/measurements/SSR-visible-interactive.png?inline";
import mismatchCard from "../assets/measurements/SSR-mismatch.png?inline";
import layoutCard from "../assets/measurements/React-layout.png?inline";
import observabilityCard from "../assets/measurements/OTel-action.png?inline";
import layoutComparisonCard from "../assets/measurements/Layout-comparison.png?inline";
import metricsFrameworkCard from "../assets/measurements/Metrics-framework.svg?inline";
import metricsFrameworkSharedCard from "../assets/measurements/Metrics-framework-shared.svg?inline";
import streamingEvidenceCard from "../assets/measurements/Streaming-comparison.svg?inline";
import lighthouseStreamingCard from "../assets/measurements/Lighthouse-streaming.png?inline";
import subscriptionCard from "../assets/measurements/RN-subscription-chart.svg?inline";
import subscriptionHermesCard from "../assets/measurements/RN-subscription-hermes.svg?inline";
import toolkitMapCard from "../assets/measurements/Toolkit-map.svg?inline";
import streamingDevtoolsCard from "../assets/measurements/Streaming-devtools.svg?inline";
import thankYouCard from "../assets/measurements/Thank-you.svg?inline";
import subscriptionReactProfilerCard from "../assets/measurements/RN-react-profiler-card.svg?inline";
import userWaitsCard from "../assets/measurements/User-waits.svg?inline";
import streamingPageCard from "../assets/measurements/Streaming-page.svg?inline";
import streamingTimelineCard from "../assets/measurements/Streaming-timeline.svg?inline";
import streamingMechanismCard from "../assets/measurements/Streaming-mechanism.svg?inline";
import sessionCountCard from "../assets/measurements/RN-session-count.svg?inline";
export const deck: Deck = {
  "meta": {
    "title": "From Profiler to Production",
    "subtitle": "React & React Native"
  },
  "nodes": [
    {
      "id": "slide-01",
      "title": "From Profiler to Production",
      "subtitle": "Measuring What Actually Matters in React & React Native",
      "size": "lg",
      "x": 240,
      "y": 300,
      "chips": [
        {
          "label": "01",
          "mono": true
        }
      ],
      "badge": {
        "label": "30 minutes total",
        "tone": "gray"
      },
      "detail": {
        "bullets": [
          "Choose metrics that reflect user experience.",
          "Know when to use each profiler — and custom instrumentation.",
          "Take away a CI template that catches performance regressions."
        ],
        "note": "State the three promised outcomes: a framework for choosing metrics, a practical toolkit, and a usable CI template. The original takeaway text supplied by Andrei on 19 November is preserved in AUDIENCE_OUTCOMES.md. These are delivery requirements, not claims that the current draft has already delivered them. Keep the fixed title and description. Introduce the speaker and GDG Linz next. A score, byte count or render duration becomes a vanity target when optimized without checking the user outcome; do not call those observations universally useless. Real Hermes, Flashlight and React DevTools workflows and a validated CI template remain required."
      }
    },
    {
      "id": "about-me",
      "title": "Andrei Tazetdinov",
      "subtitle": "Dynatrace · GDG Linz",
      "photo": speakerPhoto,
      "textWidth": 720,
      "size": "md",
      "detail": {
        "heading": "Who is talking",
        "bullets": [
          "I work on the Dynatrace React Native agent",
          "SDK-level instrumentation inside production apps",
          "Today: performance metrics, tools and reproducible measurements"
        ],
        "qr": {
          "value": "https://www.linkedin.com/in/andrei-tazetdinov/",
          "caption": "LinkedIn"
        },
        "note": "Timing: 00:15–01:00 elapsed; budget 0:45. Introduce your work on the React Native agent at Dynatrace, then move on. The linked experimental numbers are controlled local cases, not customer-production benchmarks."
      },
      "x": 2280,
      "y": 300
    },
    {
      "id": "gdg-linz",
      "title": "GDG Linz",
      "subtitle": "Google Developer Group · Linz, Austria",
      "photo": communityPhoto,
      "textWidth": 720,
      "size": "md",
      "detail": {
        "heading": "Developers meeting developers",
        "bullets": [
          "meetups, talks and workshops in Linz",
          "come by — or come and speak"
        ],
        "qr": {
          "value": "https://gdg.community.dev/gdg-linz/",
          "caption": "GDG Linz"
        },
        "note": "Timing: 01:00–01:30 elapsed; budget 0:30. Introduce GDG Linz and invite people to join or speak. The QR points to the original community page. Continue to the measurement model by 01:30."
      },
      "x": 4320,
      "y": 300
    },
    {
      "id": "performance-question",
      "title": "The report looks fast. What did the user experience?",
      "subtitle": "Different observations describe different parts of the same application",
      "size": "lg",
      "x": 6360,
      "y": 300,
      "chips": [
        {
          "label": "Why measurement needs a question"
        }
      ],
      "badge": {
        "label": "Start with the problem",
        "tone": "amber"
      },
      "detail": {
        "image": "",
        "bullets": [
          "A page can appear before its actions are ready.",
          "Smooth motion does not guarantee a responsive action.",
          "Startup, response and smoothness describe different user experiences.",
          "Before trusting a number, ask which user question it answers."
        ],
        "note": "Мы видим много хороших чисел, но не каждое отвечает на вопрос пользователя. Страница может появиться раньше, чем заработает действие; плавное движение не гарантирует быстрый ответ на касание. Сначала назовём пользовательское ожидание, затем проверим, какую часть истории измеряет выбранная метрика. Это постановка вопросов; новые кейсы ещё предстоит исследовать."
      }
    },
    {
      "id": "user-waits",
      "title": "Which wait are we measuring?",
      "subtitle": "Ready to start · Response to an action · Smooth movement",
      "size": "lg",
      "x": 8400,
      "y": 300,
      "chips": [
        {
          "label": "Restored · User questions"
        }
      ],
      "badge": {
        "label": "Ready / responsive / smooth",
        "tone": "amber"
      },
      "detail": {
        "image": userWaitsCard,
        "bullets": [
          "Opening: when can I actually start using the screen?",
          "Acting: when will I see the correct result of my input?",
          "Moving: does scrolling or animation continue without interruptions?",
          "These are different outcomes; one number cannot stand in for all three."
        ],
        "note": "Speaking cue\nСлово «быстро» прячет несколько вопросов. При открытии приложения я жду, когда смогу им пользоваться. После нажатия жду правильный результат. При скролле хочу, чтобы движение не прерывалось.\n\nЭто три разных свойства. Экран может быстро появиться, но поздно начать отвечать. Он может отвечать на кнопку, но дёргаться при движении. Сейчас мы ещё не выбираем инструмент — называем то ожидание, которое хотим исследовать.\n\nPreparation / sources\nRestores the earlier user-wait introduction as a separate card. The shared framework diagram remains on framework-choice later. Full speaking script: speaker-guide/framework-metrics.md, user questions. RN-specific launch/touch/frame sources stay on framework-native."
      }
    },
    {
      "id": "framework-map",
      "title": "Web: three questions, different measurements.",
      "subtitle": "Navigation, interaction and browser rendering",
      "size": "lg",
      "x": 240,
      "y": 1900,
      "chips": [
        {
          "label": "Restored · Web measurement map"
        }
      ],
      "badge": {
        "label": "Name the boundary",
        "tone": "amber"
      },
      "detail": {
        "image": "",
        "bullets": [
          "Open: navigation → defined usable state. Verify a representative action; state network and cache conditions.",
          "Act: input → visible correct result. Name the source that observes the endpoint.",
          "Move: browser frame timing during the selected scroll or animation.",
          "Legacy TTI is a specific web lab metric; an app-ready marker is a different measurement."
        ],
        "note": "Speaking cue\nТеперь связываем эти вопросы с измерением на вебе. Для открытия называем событие навигации и проверяемое usable состояние. Для действия называем input и наблюдение результата. Для движения — участок сценария и источник frame timing.\n\nНазвание метрики ещё не определяет её границы. Первый React effect не доказывает, что нужное действие уже работает. И обещанный TTI — конкретная legacy lab-метрика, удалённая из Lighthouse 10, а не любое время до нашего marker готовности.\n\nДля React Native этот перевод сделаем отдельно, когда дойдём до мобильной части.\n\nPreparation / sources\nRestored framework-map card; no slides removed for this restoration. Full map and caveats: speaker-guide/framework-metrics.md. Sources: https://web.dev/articles/tti ; https://react.dev/reference/react-dom/client/hydrateRoot . Hydration work is not the entire wait for JS; hydrateRoot return is not universal completion. Browser Event Timing has its own endpoint and does not establish physical presentation or arbitrary async completion."
      }
    },
    {
      "id": "framework-proxies",
      "title": "What can this number prove?",
      "subtitle": "Use each number to answer its own question",
      "size": "lg",
      "x": 2280,
      "y": 1900,
      "chips": [
        {
          "label": "Web · Reading the numbers"
        }
      ],
      "badge": {
        "label": "Working framework",
        "tone": "amber"
      },
      "detail": {
        "image": "",
        "bullets": [
          "Lighthouse score → the load audit under its stated conditions; test later actions separately.",
          "Bundle size → code volume; inspect the work that actually executes.",
          "React actualDuration → rendering in the profiled tree; inspect the rest of the path to display."
        ],
        "note": "Speaking cue\nLighthouse отвечает про загрузку в условиях аудита. Последующее действие проверяем отдельно.\nРазмер бандла говорит об объёме кода. Сколько работы исполнится, нужно выяснить.\nReact actualDuration показывает render профилируемого дерева. До результата на экране есть и другая работа.\n\nЭти числа полезны. Vanity target получается, когда улучшение одного из них принимают за пользовательскую\nпобеду без проверки действия. Поэтому правило такое: профилем ищем причину, а исправление принимаем\nпо повторному измерению того же результата с сохранённой корректностью и работой\n\nPreparation / sources\nspeaker-guide/framework-metrics.md, reading the numbers. Sources: https://react.dev/reference/react/Profiler ; https://developer.chrome.com/docs/lighthouse/performance/performance-scoring . actualDuration describes rendering of the profiled tree, not all React DevTools capabilities. Retain build, device, scenario, source and repeated-run variation. Next: framework-choice, a synthesis of the preceding user questions and measurement boundaries."
      }
    },
    {
      "id": "framework-choice",
      "title": "Choose the metric. Find the cause. Verify the gain.",
      "subtitle": "Shared method for Web and React Native",
      "size": "lg",
      "x": 4320,
      "y": 1900,
      "chips": [
        {
          "label": "Shared measurement framework"
        }
      ],
      "badge": {
        "label": "Outcome → diagnosis → decision",
        "tone": "amber"
      },
      "detail": {
        "image": metricsFrameworkSharedCard,
        "bullets": [
          "Outcome: choose what the user waits for and define one primary metric.",
          "Diagnosis: profile the work and identify a testable cause.",
          "Decision: repeat the same task, preserve correctness and work, compare the primary metric."
        ],
        "note": "Соберём общий порядок: сначала определяем пользовательский результат и границы измерения; затем ищем причину; после изменения повторяем ту же задачу и проверяем результат и корректность. Теперь применим этот подход к первому расследованию: видимый каталог и раннее нажатие."
      }
    },
    {
      "id": "web-early-action-story",
      "title": "The page is visible. Is the action ready?",
      "subtitle": "Investigation 01 · Streaming SSR",
      "size": "lg",
      "x": 6360,
      "y": 1900,
      "chips": [
        {
          "label": "Investigation 01 · Web"
        }
      ],
      "badge": {
        "label": "01 · The question",
        "tone": "amber"
      },
      "detail": {
        "image": streamingPageCard,
        "bullets": [
          "A catalog and its sort button arrive in the early HTML.",
          "A separate recommendations section is still loading.",
          "The user clicks “Price: low to high”. What happens?",
          "We investigate the path from visible content to a working action."
        ],
        "note": "Речь\nПользователь открывает каталог, видит товары и нажимает «сначала дешёвые». Рекомендации ниже ещё загружаются, но для сортировки уже показанных товаров они вроде бы не нужны.\n\nМожно ли в этот момент пользоваться кнопкой? И если нажатие ничего не делает, как понять причину?\n\nПодготовка и источники\nПереход от общей схемы: давайте применим её к первому расследованию. Пользователь открывает каталог, видит товары и сразу нажимает сортировку. Блок рекомендаций внизу ещё загружается, но для сортировки он не нужен. Вопрос: работает ли кнопка, пока эта часть страницы не пришла? Это созданный нами лабораторный React-пример, не история клиента. На следующем слайде — проверяемая гипотеза о зависимости от запуска клиентского кода. Источники: research/01-web-streaming.md и research/01-action-comparison-protocol.md.\n\nПолный послайдовый текст: speaker-guide/investigation-01-streaming.md."
      }
    },
    {
      "id": "web-streaming-lighthouse",
      "title": "Lighthouse: 100. The click is still lost.",
      "subtitle": "The same page · the variant where the early click does nothing",
      "size": "lg",
      "x": 8400,
      "y": 1900,
      "chips": [
        {
          "label": "Investigation 01 · Web"
        }
      ],
      "badge": {
        "label": "01 · The report",
        "tone": "amber"
      },
      "detail": {
        "image": lighthouseStreamingCard,
        "bullets": [
          "Performance 100 · FCP 0.2 s · LCP 0.2 s · TBT 0 ms · CLS 0.",
          "Lighthouse loads the page and scores the load. It never clicks.",
          "Same variant, Chrome trace run: click at ~750 ms, no sort until the page finished loading."
        ],
        "note": "Речь\nПрежде чем искать причину, посмотрим, что говорит стандартный отчёт. Это та самая страница, в том варианте, где ранний клик теряется. Lighthouse: 100. FCP и LCP — 0,2 секунды, TBT — ноль.\n\nОтчёт не врёт: страница действительно быстро показала содержимое и не блокировала поток. Он просто отвечает на другой вопрос. Lighthouse загружает страницу и оценивает загрузку — он никогда не нажимает кнопку. А наш пользователь нажал.\n\nПодготовка и источники\nLighthouse 13.6.0, Node API, desktop preset, Chrome 157 headless, localhost, задержка рекомендаций 3000 ms. Оба варианта (module и async) получили 100; скриншот — вариант module. В том же варианте под записью Chrome-трейса ранний клик на 749 ms не дал сортировки, рекомендации пришли на 3007 ms; в async сортировка на 747 ms. Скрипт: research/streaming-lighthouse-trace.mjs; сводка: research/streaming-lighthouse-result.json; полный отчёт и трейсы — artifacts/lighthouse-module.html, artifacts/trace-module.json, artifacts/trace-async.json (трейс открывается в Chrome DevTools → Performance, перетащить файл). Один прогон Lighthouse на вариант, не серия."
      }
    },
    {
      "id": "web-streaming-diagnosis",
      "title": "Which events explain the missing action?",
      "subtitle": "One recorded baseline run · browser timestamps since navigation",
      "size": "lg",
      "x": 240,
      "y": 3500,
      "chips": [
        {
          "label": "Investigation 01 · Web"
        }
      ],
      "badge": {
        "label": "01 · How we found it",
        "tone": "amber"
      },
      "detail": {
        "image": streamingTimelineCard,
        "bullets": [
          "785 ms — trusted click; no sorted result was observed.",
          "3015 ms — delayed recommendations appeared in the DOM.",
          "3037 ms — client entry started; React could now begin hydration.",
          "Evidence: browser event listener + DOM observer + entry marker, retained in JSON."
        ],
        "note": "Речь\nМы начали с события пользователя. Независимый обработчик документа записал нажатие примерно на 785-й миллисекунде. Сортировка после него не произошла.\n\nЗатем мы посмотрели, когда появился поздний блок и когда вообще запустился клиентский код. Рекомендации появились в DOM примерно на 3015-й миллисекунде, а клиентский entry стартовал на 3037-й. То есть во время нажатия код приложения ещё даже не запустился.\n\nЭти числа мы получили своими метками: обработчик документа зафиксировал нажатие, `MutationObserver` увидел изменение DOM, а метка в entry — запуск кода. Playwright выполнил сценарий и сохранил события в JSON.\n\nПодготовка и источники\nКак мы нашли причину: сначала взяли опубликованную историю X Engineering как источник гипотезы, затем воспроизвели её в своём лабораторном React-каталоге. В контрольном запуске независимый document listener записал доверенный клик на 784,7 ms, MutationObserver увидел рекомендации на 3014,8 ms, а метка в entry зафиксировала его запуск на 3037,2 ms. Сортировка после первого клика не произошла, но позднее повторное нажатие сработало. Это один из шести контрольных запусков повторной серии; исходник research/streaming-action-comparison.json, первая запись module. Метки от навигации на одних часах браузера, DOM не равен paint. Так мы видим, что во время раннего клика клиентский entry ещё не запускался. Это не Chrome Performance trace, не React DevTools profile, не production RUM и не измерение длительности hydration. На следующем слайде объясняем механизм и сравнение. В production нужен независимый ранний сбор ввода до загрузки React: instrumentation, которая сама запускается позже, потерянный ранний клик не увидит. Локальный пилот раннего сбора и отдельный OTel replay описаны в research/01-early-observability.md; production и алертинг не проверены.\n\nПолный послайдовый текст: speaker-guide/investigation-01-streaming.md."
      }
    },
    {
      "id": "web-streaming-devtools",
      "title": "The real profiler: the click came first.",
      "subtitle": "Chrome DevTools → Performance · recorded trace, regular module",
      "size": "lg",
      "x": 2280,
      "y": 3500,
      "chips": [
        {
          "label": "Investigation 01 · Web"
        }
      ],
      "badge": {
        "label": "01 · Chrome DevTools",
        "tone": "amber"
      },
      "detail": {
        "image": streamingDevtoolsCard,
        "bullets": [
          "748 ms — Event: click in Interactions and Main.",
          "3008 ms — Evaluate module /client.js: the app code starts only now.",
          "Async variant: the same module starts at 36 ms.",
          "INP 10 ms is green: it measures event handling, not whether the sort happened."
        ],
        "note": "Речь\nТо же самое видно и в обычном инструменте. Это Chrome DevTools, вкладка Performance, запись той же сцены с обычным module. Клик — на 748-й миллисекунде, он есть на дорожке Interactions. А выполнение нашего /client.js — Evaluate module — начинается только около трёх секунд. Порядок тот же, что показали наши метки: сначала клик, кода приложения ещё нет.\n\nИ обратите внимание слева: INP 10 миллисекунд, зелёный. Браузер быстро обработал событие — только обрабатывать было нечем. Хороший INP не говорит, что сортировка произошла. Это вторая зелёная метрика при потерянном действии, после Lighthouse 100.\n\nДля сравнения: в async-варианте тот же модуль выполняется на 36-й миллисекунде.\n\nПодготовка и источники\nСуществующие artifacts/trace-module.json и trace-async.json (research/streaming-lighthouse-trace.mjs), открыты 21 ноября 2026 в Chrome DevTools 157 Performance; новых прогонов нет. Время от navigationStart: EventDispatch click 748,412 ms (0,102 ms), v8.evaluateModule /client.js 3008,135 ms (2,266 ms); async evaluateModule 36,001 ms. Это отдельный прогон от прогона с метками на предыдущей карточке (785/3015/3037 ms) — числа не смешивать. Evaluate module — начало выполнения модуля, не установка всех обработчиков и не гидратация. Insights трейса: module LCP 0,04 s, INP 10 ms; async INP 72 ms — это показатели импортированных записей, не Lighthouse. Итог действия (sortedMs null / 747) — из research/streaming-lighthouse-result.json, не из профиля. Снимки и notes.md: research/figures/streaming-devtools/; машинная выписка: trace-facts.json."
      }
    },
    {
      "id": "web-streaming-mechanism",
      "title": "Could the rest of the page delay the button?",
      "subtitle": "The HTML streams in parts; the client entry is a module.",
      "size": "lg",
      "x": 4320,
      "y": 3500,
      "chips": [
        {
          "label": "Investigation 01 · Web"
        }
      ],
      "badge": {
        "label": "01 · The hypothesis",
        "tone": "amber"
      },
      "detail": {
        "image": streamingMechanismCard,
        "bullets": [
          "A regular module waits for the document to finish parsing.",
          "The late recommendations keep the streamed document open.",
          "Hypothesis: the client code for the visible catalog starts late.",
          "Compare the same app with the same entry loaded as an async module."
        ],
        "note": "Речь\nСервер отдаёт HTML частями. Но обычный модульный скрипт ожидает завершения разбора документа. В нашей сцене документ остаётся открытым, пока сервер не отдаст задержанные рекомендации.\n\nМы проверили гипотезу: если подключить тот же клиентский модуль как `async`, сможет ли он запуститься раньше? В отдельной предварительной браузерной пробе обычный модуль стартовал примерно на 3012-й миллисекунде, а `async` — примерно на 29-й.\n\nНо более ранний запуск скрипта ещё не отвечает на главный вопрос. Нужно снова нажать кнопку и проверить результат.\n\nПодготовка и источники\nПравдоподобная версия: сама кнопка в HTML есть, но её React-обработчик ещё не подключён. Обычный module откладывает выполнение до завершения разбора документа; поток продолжается, пока сервер не отдаст позднюю часть. Проверяем, что произойдёт, если тот же клиентский entry запустить как async. В отдельном диагностическом прогоне обычный модуль начал работу около 3012 ms, async — около 29 ms, при задержке рекомендаций 3000 ms. Это время запуска entry, не замер длительности hydration. На следующем слайде — что произошло с реальным нажатием. Источник: research/01-web-streaming.md, streaming-browser-result.json. Документация браузерных модулей: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules/Modules_on_the_web .\n\nПолный послайдовый текст: speaker-guide/investigation-01-streaming.md."
      }
    },
    {
      "id": "web-streaming-comparison",
      "title": "Same early click. Different result.",
      "subtitle": "React streaming SSR · local controlled comparison",
      "size": "lg",
      "x": 6360,
      "y": 3500,
      "chips": [
        {
          "label": "Investigation 01 · Web"
        }
      ],
      "badge": {
        "label": "6 controlled pairs",
        "tone": "amber"
      },
      "detail": {
        "image": streamingEvidenceCard,
        "bullets": [
          "Regular module: early click lost in 6/6. Async: correct sort before delayed content in 6/6."
        ],
        "note": "Речь\nНа обоих снимках рекомендации ещё загружаются. Слева после раннего нажатия порядок товаров не изменился. Справа то же действие привело к сортировке, хотя поздний блок ещё не пришёл.\n\nМы не остановились на одном снимке: сделали шесть пар запусков с чередованием порядка. В обычном варианте ранний клик потерялся во всех шести запусках. В варианте с `async` правильная сортировка произошла до прихода рекомендаций во всех шести. После полной загрузки повторное нажатие в обычном варианте тоже работало.\n\nПодготовка и источники\nПоказываем два реальных снимка после раннего клика, по одному на вариант. Рекомендации ещё загружаются. В обычном module клик потерян, в async товары отсортированы. Шесть пар с чередованием AB/BA: Chrome 157 headless, localhost, React production bundle, задержка 3000 ms, клик после 700 ms, одинаковый код. Во всех шести обычных запусках ранний клик потерян; во всех шести async сортировка до рекомендаций. 12/12 валидны, ошибок hydration не отмечено, итоговый порядок корректен. Скриншоты: research/figures/streaming-module.png и streaming-async.png; результаты: research/streaming-action-comparison.json; протокол: research/01-action-comparison-protocol.md. DOM не равен физическому paint; это не замер стоимости hydration и не production benchmark. Async не универсальное решение: необходимо проверить порядок скриптов, готовность DOM и зависимости.\n\nПолный послайдовый текст: speaker-guide/investigation-01-streaming.md."
      }
    },
    {
      "id": "web-streaming-takeaway",
      "title": "Visible content is not a working action.",
      "subtitle": "Choose the user outcome; use timing to investigate why.",
      "size": "lg",
      "x": 8400,
      "y": 3500,
      "chips": [
        {
          "label": "Investigation 01 · Web"
        }
      ],
      "badge": {
        "label": "01 · What we learned",
        "tone": "amber"
      },
      "detail": {
        "image": "",
        "bullets": [
          "Outcome: did the early click produce the correct order?",
          "Diagnosis: when did the entry start, relative to the streamed document?",
          "Decision: compare the same action and verify the final result.",
          "Async is a candidate, not a universal fix: check script dependencies and DOM readiness."
        ],
        "note": "Речь\nВ обоих вариантах товары и кнопка были видны. Но видимое содержимое не гарантировало, что действие готово.\n\nНаш пользовательский результат — не появление кнопки и не запуск модуля. Это правильная сортировка после нажатия. А время запуска скрипта и приход позднего HTML помогли исследовать причину.\n\nВ этой лабораторной сцене `async` изменил результат. Прежде чем переносить решение в приложение, нужно проверить готовность DOM, зависимости и порядок скриптов. Мы не измеряли здесь стоимость hydration и не знаем, как часто такое происходит у реальных пользователей.\n\nПодготовка и источники\nВозвращаемся к framework. Результат для пользователя — корректная сортировка после конкретного нажатия. В шести парах ранний клик с обычным module потерялся, с async сработал до рекомендаций; фактические условия и границы на предыдущем слайде. Диагностика порядка запуска помогла объяснить, почему видимый HTML ещё не означает доступный обработчик. Это не измерение стоимости hydration, не вывод о production-частоте и не рекомендация безусловно ставить async: нужно проверить зависимости и готовность DOM. По завершении этого кейса перейдём к React Native: там плавное движение тоже может не отвечать на вопрос о другом действии пользователя. Источники: research/01-web-streaming.md, research/streaming-action-comparison.json.\n\nПолный послайдовый текст: speaker-guide/investigation-01-streaming.md."
      }
    },
    {
      "id": "web-streaming-frameworks",
      "title": "Why Next.js already does this",
      "subtitle": "The framework loads client chunks async — a hand-rolled SSR may not",
      "size": "lg",
      "x": 240,
      "y": 5100,
      "chips": [
        {
          "label": "Investigation 01 · Web"
        }
      ],
      "badge": {
        "label": "01 · In a real framework",
        "tone": "amber"
      },
      "detail": {
        "image": "",
        "bullets": [
          "Next.js 16.3.8 production build: 7 of 7 client chunks load as <script async> (the 8th is a noModule polyfill).",
          "So in a default Next.js app this early click is not lost — the framework already made the fix.",
          "It comes back when you stream SSR yourself: your own server, a <script type=\"module\"> entry without async.",
          "Changing the setup or the framework? Re-check the action, not the score."
        ],
        "note": "Речь\nЕсли вы пишете на Next.js, вы сейчас думаете: у нас такого нет. И вы правы — и это хорошая новость. Я собрал production-сборку Next.js 16 и посмотрел HTML: все клиентские чанки подключены с async. Фреймворк уже сделал то исправление, к которому мы пришли сами.\n\nЭтот кейс — объяснение, зачем он так делает. И что ломается, когда вы уходите от фреймворка: свой сервер со streaming, свой entry с type=\"module\". Тогда видимая кнопка снова может не работать, а Lighthouse по-прежнему покажет 100.\n\nПодготовка и источники\nПроверено 20 ноября 2026: Next.js 16.3.8, next build + next start, HTML главной страницы — 8 тегов script с src, 7 из них async, восьмой noModule (полифил для старых браузеров). Это одна страница одного приложения (Porto Shop из воркшопа); другие фреймворки и режимы (Pages Router, Vite SSR, Remix) не проверялись — не называть их со сцены как подтверждённые."
      }
    },
    {
      "id": "web-streaming-observability",
      "title": "How could we see this after release?",
      "subtitle": "A local pilot: collect the action before React starts",
      "size": "lg",
      "x": 2280,
      "y": 5100,
      "chips": [
        {
          "label": "Investigation 01 · Web"
        }
      ],
      "badge": {
        "label": "01 · Observe the action",
        "tone": "amber"
      },
      "detail": {
        "image": "",
        "bullets": [
          "Early listener records attempts before React starts.",
          "Local browser reports reach a receiver during the same experiment.",
          "The receiver exports counters through OpenTelemetry to an OTLP endpoint.",
          "Attempts without confirmed outcomes stay unknown."
        ],
        "note": "Речь\nЕсли сборщик сам загружается вместе с поздним React-кодом, раннее нажатие он тоже может пропустить. Поэтому мы проверили небольшой отдельный обработчик, который устанавливается раньше и фиксирует попытку. Затем он ждёт подтверждения, что сортировка действительно обработана и правильный порядок появился в DOM.\n\nВ локальном запуске браузер отправлял отчёты в JSON-приёмник. Тот записывал счётчики через OpenTelemetry SDK и передавал их в тестовый OTLP-приёмник. Так мы проверили всю эту лабораторную цепочку в одном запуске.\n\nМы проверили и сам сборщик. В одном сценарии два повторных нажатия дали две отдельные попытки и два подтверждения. При закрытии страницы после нажатия попытка дошла, но итогового сообщения мы не получили. Это неизвестный исход: его нельзя автоматически записывать ни в успех, ни в ошибку.\n\nПодготовка и источники\nВопрос после профиля: как обнаружить такое действие после релиза? Если инструментация запускается вместе с поздним React entry, ранний клик она не увидит. В локальном пилоте отдельный inline-обработчик устанавливается в HTML заранее, фиксирует первое доверенное нажатие и 1200 ms ждёт статус сортировки. Сервер действительно принял JSON: обычный module — no_success_within_window; async — observed_success. Один запуск на вариант; это не статистика и не полноценный production SDK. Отдельный Node OTel SDK повторно отправил уже полученные два результата в локальный OTLP/HTTP receiver; одна посылка и две metric points проверены. Это replay, не прямой browser OTLP или live RUM. Таймаут 1.2 s выбран для опыта; он не доказывает потерю и не является UX-бюджетом. Перед реальным использованием нужны CSP, стоимость, жизненный цикл, точная корреляция, доставка, реальные версии, baseline и проверка сигнала регрессии. Материал: research/01-early-observability.md.\n\nСледующая проверка ограничений: два нажатия в async увидел диагностический listener, но ранний сборщик отправил только один отчёт; при закрытии до таймера 1200 ms отчёт не дошёл. Контрольная открытая страница отправила no_success_within_window. При закрытии sendBeacon ещё не вызывался, поэтому это не тест его надёжности. Определения и результаты: research/01-action-signal.md. Нельзя считать эти исходы долей всех успешных нажатий.\n\nПовтор после изменения: в одном запуске два нажатия дали две отдельные попытки и два подтверждённых успеха. При закрытии ранняя попытка пришла, но прерванный исход не получен: неизвестно, сработал ли pagehide. В открытом контрольном сценарии пришли попытка и no_success_within_window. Не приравнивать неизвестный исход к ошибке. Исходные данные и ограничения: research/01-action-signal.md и research/streaming-monitor-scenarios-after.json. Предыдущий OTel replay использует прежние отчёты, новую сквозную цепочку ещё не проверяли.\n\nДополнение: теперь проведён сквозной локальный запуск без replay: browser → JSON receiver → Node OTel SDK → OTLP receiver. Все шесть запусков дали сопоставленные данные, см. research/01-regression-check-result.md. Это лабораторная цепочка и не production monitoring.\n\nПолный послайдовый текст: speaker-guide/investigation-01-streaming.md."
      }
    },
    {
      "id": "web-streaming-regression",
      "title": "Can the measurement catch the regression?",
      "subtitle": "Local check · three pairs · same user action",
      "size": "lg",
      "x": 4320,
      "y": 5100,
      "chips": [
        {
          "label": "Investigation 01 · Web"
        }
      ],
      "badge": {
        "label": "01 · Regression check",
        "tone": "amber"
      },
      "detail": {
        "image": "",
        "bullets": [
          "Baseline: async module — 3 / 3 actions confirmed within 1.2 s → PASS.",
          "Regression: regular module — 0 / 3 confirmed within 1.2 s → FAIL.",
          "Browser reports → local receiver → OTel counter → OTLP receiver: counts match.",
          "The rule and delay are lab choices; actual CI and production alerting remain to verify."
        ],
        "note": "Речь\nМы заранее записали правило для этой контролируемой сцены и провели три пары запусков. В работающем варианте с `async` все три ранних действия получили подтверждение в пределах окна. В варианте с обычным модулем ни одно из трёх не получило подтверждение в этом окне.\n\nПолученные приёмником события совпали с четырьмя точками счётчика, доставленными через OTLP. Локальный оценщик вернул для baseline код ноль, а для намеренно возвращённой проблемы — код один. Такой код можно использовать в CI.\n\nВажно: мы пока запустили эту проверку локально, а не в CI-платформе. Три пары и окно 1,2 секунды — выбор для демонстрации, а не доказанный порог для реального продукта. Для production нужны достаточный baseline, проверка доставки, выбор окна и правило оповещения.\n\nПодготовка и источники\nПрименяем заранее записанное строгое правило к искусственной сцене: три пары, Chrome 157, localhost, задержка рекомендаций 3000 ms, клик после 700 ms, окно результата 1200 ms. В трёх async запусках исход подтверждён, baseline pass; в трёх с обычным module в окне подтверждения нет, regression. Все шесть валидны, конечный порядок совпадает, OTLP-приёмник получил четыре точки с совпадающими счётчиками. Локальный оценщик результата возвращает 0 для async и 1 для module; код 2 отведён неизвестным данным. Это можно подключить к CI, но реальная CI-платформа и алертинг ещё не проверялись. 1200 ms не обоснован как production UX-бюджет. Доставка при закрытии, CSP, нагрузка и физический paint остаются ограничениями. Источник: research/01-regression-check-result.md; все результаты research/streaming-gate-result.json.\n\nПолный послайдовый текст: speaker-guide/investigation-01-streaming.md."
      }
    },
    {
      "id": "transition-to-native",
      "title": "From browser to mobile: follow the user",
      "subtitle": "The same question, different measurement boundaries",
      "size": "lg",
      "x": 6360,
      "y": 5100,
      "chips": [
        {
          "label": "Web → React Native"
        }
      ],
      "badge": {
        "label": "Web → React Native",
        "tone": "amber"
      },
      "detail": {
        "image": "",
        "bullets": [
          "Web: a visible page did not guarantee a working action.",
          "React Native: identify when the app is ready, responsive and smooth.",
          "Choose user-visible boundaries, then use platform tools to find the cause."
        ],
        "note": "Переход: на вебе видимое состояние страницы не гарантировало, что действие уже работает. На мобильной платформе сохраняем тот же вопрос о пользовательском результате, но заново определяем границы и источники измерений: запуск, ответ на действие и движение."
      }
    },
    {
      "id": "framework-native",
      "title": "React Native: ready, responsive, smooth?",
      "subtitle": "Native launch → usable · Touch → result · Native frame timing",
      "size": "lg",
      "x": 8400,
      "y": 5100,
      "chips": [
        {
          "label": "React Native · Metrics framework"
        }
      ],
      "badge": {
        "label": "Working framework",
        "tone": "amber"
      },
      "detail": {
        "image": "",
        "bullets": [
          "Ready: native launch → a usable screen; distinguish cold and warm starts.",
          "Responsive: touch → visible correct result; a JS / React callback is an internal checkpoint.",
          "Smooth: native frame timing for the chosen scene; inspect JS stalls separately."
        ],
        "note": "Для React Native называем пользовательские ожидания и границы отдельно: готовность после запуска, ответ на действие и плавность движения. Источник события касания и наблюдаемый результат не обязательно используют одинаковые часы; JS callback или layout сами по себе не доказывают показ кадра. Сначала проверяем задачу и результат пользователя, затем выясняем причину."
      }
    },
    {
      "id": "rn-subscription-scene",
      "title": "The screen is gone. What keeps running?",
      "subtitle": "An orders screen subscribes to order updates in useEffect.",
      "size": "lg",
      "x": 240,
      "y": 6700,
      "chips": [
        {
          "label": "Investigation 02 · React Native"
        }
      ],
      "badge": {
        "label": "02 · React Native",
        "tone": "amber"
      },
      "detail": {
        "image": "",
        "bullets": [
          "Open and close the screen 1, 10 or 30 times.",
          "Then send 10 order updates while the screen is closed.",
          "Each handler updates and sorts its own 500-order list."
        ],
        "note": "На вебе видимая кнопка ещё не означала готовое действие. Теперь перевернём вопрос:\nесли экран уже исчез, означает ли это, что его работа остановилась?\n\nПеред нами экран заказов. На слайде сокращённый код: при монтировании useEffect\nподписывается на обновления. Приходит событие — обработчик находит заказ, обновляет\nего, сортирует список и вызывает setOrders. В нашей лабораторной сцене в списке\n500 заказов. Пока просто запомним этот хук — к нему ещё вернёмся.\n\nОткрываем экран, закрываем. Потом снова открываем и закрываем. Сравним один,\nдесять и тридцать визитов. Затем, уже после закрытия всех экранов, отправляем\nдесять обновлений заказов с интервалом 200 миллисекунд. Что в этот момент должно\nвыполняться от имени закрытого экрана?\n\nПоказать хук на карточке; указать на useEffect и подписку. Пока не разбирать\nисправление. События создаёт тестовый emitter; это лабораторная модель с намеренно\nвведённой ошибкой, не запись работы реального websocket и не production-инцидент.\n\nПолный рассказ: speaker-guide/investigation-02-subscriptions.md. Источник: research/06-rn-subscription-pilot.md.",
        "code": {
          "lang": "tsx",
          "text": "function OrdersScreen() {\n  const [orders, setOrders] = useState(makeOrders) // 500 orders\n  useEffect(() => {\n    function onOrderUpdate(event) {\n      // update one order, sort all 500, setOrders(...)\n    }\n    listeners.add(onOrderUpdate)\n  }, [])\n  return <OrderList orders={orders} />\n}"
        }
      }
    },
    {
      "id": "rn-subscription-react",
      "title": "React: no renders from the closed screen.",
      "subtitle": "Recorded Debug profile: OrdersScreen is absent during the event stream.",
      "size": "lg",
      "x": 2280,
      "y": 6700,
      "chips": [
        {
          "label": "Investigation 02 · React Native"
        }
      ],
      "badge": {
        "label": "02 · React Native",
        "tone": "amber"
      },
      "detail": {
        "image": subscriptionReactProfilerCard,
        "bullets": [
          "173 commits across the full pilot, including screen visits and UI updates.",
          "Leak / 30: App and its UI children commit at stream entry; OrdersScreen is absent.",
          "No further commits before the next stage: commit 87 → commit 88."
        ],
        "note": "Снята настоящая запись React Native DevTools Profiler 21 ноября 2026: неизменённая SubscriptionStreamPilot.js, Debug, RN 0.88.0, React 19.3.0, Hermes, iOS Simulator 26.3. Кнопка Start pilot прошла все шесть состояний; отдельного переключателя leak/30 в этой сцене нет.\n\nЗа весь записанный прогон — 173 коммита, включая открытие/закрытие экранов, переключения фаз и UI кнопки. В leak/30 последний OrdersScreen размонтирован в коммите №86. Коммит №87 при входе в поток: updater App; рендерились App, Button, Text, View, TouchableOpacity и PressabilityDebugView. OrdersScreen отсутствует. Render всего коммита 3,523 мс (UI округляет до 3,5 мс), App self — около 0,4 мс. Это входной коммит от setPhase, а не работа обработчика события.\n\nМежду №87 (28,995 с) и №88 (31,183 с, следующий этап) новых коммитов нет; десять обновлений закрытого экрана не породили новых коммитов. Границы определены по mount/remove-операциям экспорта и фиксированному порядку сцены, без добавления меток в код. Снимка коммита от отдельного события в этом интервале нет, поскольку такого коммита не записано.\n\nДополнительный факт: на первом leak/1-потоке после входного коммита был один коммит View (Animated) кнопки, 0,381 мс. Поэтому не говорить «весь Profiler пустой» или «рендерился только App». Говорим: закрытый OrdersScreen не рендерился во время потоков; другие части UI могли рендериться.\n\nПоказать настоящий снимок Ranked-коммита №87. Это Debug, qualitative: 3,5 мс не сравниваем с Release-цифрами графика и не называем временем JS-события. В следующей карточке Hermes рассматриваем выполняющийся код, которого отсутствие рендера экрана не исключает.\n\nЭкспорт и сырые снимки: research/figures/rn-subscription-pilot/react-profiler-2026-11-21/. Анализ: analysis.json. Исходник сцены SHA-256: 923acbb89b4935d2ced6f549f2366ad0e3edc12383827f49c0037093936e7df8. Подробности: research/06-rn-subscription-pilot.md. Речь: speaker-guide/investigation-02-subscriptions.md."
      }
    },
    {
      "id": "rn-subscription-hermes",
      "title": "Hermes: the sort is expensive. Optimize it?",
      "subtitle": "A sampling CPU profile locates the work. Does it explain why it runs?",
      "size": "lg",
      "x": 4320,
      "y": 6700,
      "chips": [
        {
          "label": "Investigation 02 · React Native"
        }
      ],
      "badge": {
        "label": "02 · React Native",
        "tone": "amber"
      },
      "detail": {
        "image": subscriptionHermesCard,
        "bullets": [
          "Recorded stack: onOrderUpdate → arrayPrototypeSort.",
          "First hypothesis: make the sorting cheaper.",
          "Missing question: how many subscribers run it for one update?"
        ],
        "note": "Вот настоящий снимок из нашей Hermes-записи: onOrderUpdate, под ним —\narrayPrototypeSort. Значит, время уходит в обработку обновления и сортировку.\nПервая правдоподобная идея: сортировка дорогая, давайте её ускорим.\n\nНо прежде чем менять алгоритм, зададим вопрос, которого на этом снимке нет:\nсколько раз обработчик вообще должен вызываться на одно обновление? И почему\nработа экрана продолжается после его закрытия?\n\nПрофиль дал нам место затрат. Чтобы проверить причину, добавим простой счётчик.\n\nЗаголовок карточки: «Hermes: the sort is expensive. Optimize it?».\nПоказать [читаемый снимок](../research/figures/rn-subscription-pilot/hermes-focused-event.png).\nДля сцены выбрано окно исходных сэмплов 37,142–37,162 с с поддеревом onOrderUpdate;\nслужебные уровни скрыты, остальные стеки обозначены outside focused subtree.\nЭто фильтрация исходных сэмплов, а не новая запись или точное измерение границ события.\nЭто Debug sampling trace; он охватывает разные стадии. Времена на снимке не сравниваем\nс Release. Отдельные сэмплы не считаем вызовами или копиями подписчиков.\n\nПолный рассказ: speaker-guide/investigation-02-subscriptions.md. Источник: research/06-rn-subscription-pilot.md."
      }
    },
    {
      "id": "rn-subscription-counter",
      "title": "One update. Thirty callbacks.",
      "subtitle": "The listener count exposes it: the hook never unsubscribes.",
      "size": "lg",
      "x": 6360,
      "y": 6700,
      "chips": [
        {
          "label": "Investigation 02 · React Native"
        }
      ],
      "badge": {
        "label": "02 · React Native",
        "tone": "amber"
      },
      "detail": {
        "image": "",
        "bullets": [
          "1 visit → 1 listener → 10 callbacks for 10 updates.",
          "10 visits → 10 listeners → 100 callbacks.",
          "30 visits → 30 listeners → 300 callbacks.",
          "While synchronous handlers run, other work on the JS thread waits."
        ],
        "note": "Сколько подписок осталось? После первого закрытия — одна. После десятого —\nдесять. После тридцатого — тридцать. Открытых экранов заказов при этом ноль.\nОдно обновление вызывает тридцать обработчиков. Десять обновлений — триста вызовов.\n\nТеперь возвращаемся к хуку. В useEffect есть listeners.add, но нет функции\nочистки. React может вызвать возвращённую из эффекта функцию при размонтировании,\nно здесь возвращать нечего. Подписка пережила экран. Каждый новый визит добавил\nещё одну.\n\nВот почему оптимизация сортировки была бы неполным ответом. Если ускорить один\nобработчик вдвое, лишние обработчики останутся. Надо остановить работу, которую\nзакрытые экраны вообще больше не должны делать.\n\nПоказать код с отсутствующей строкой очистки. Число 30 получено счётчиком\nподписок нашего emitter, а не подсчётом сэмплов Hermes. Сами профилировщики не\nобязаны отличать экземпляры одинакового замыкания по экрану, который их создал.\n\nПолный рассказ: speaker-guide/investigation-02-subscriptions.md. Источник: research/06-rn-subscription-pilot.md.",
        "code": {
          "lang": "tsx",
          "text": "useEffect(() => {\n  listeners.add(onOrderUpdate)\n  // return () => listeners.delete(onOrderUpdate)   ← this line is missing\n}, [])"
        }
      }
    },
    {
      "id": "rn-subscription-fix",
      "title": "The screen is closed. Its handlers are not.",
      "subtitle": "One line fixes it: return the unsubscribe from useEffect.",
      "size": "lg",
      "x": 8400,
      "y": 6700,
      "chips": [
        {
          "label": "Investigation 02 · React Native"
        }
      ],
      "badge": {
        "label": "02 · React Native",
        "tone": "amber"
      },
      "detail": {
        "image": subscriptionCard,
        "bullets": [
          "No cleanup: JS work per update grows with visits — 0.45 → 4.3 → 12.4 ms (mean of 4 runs).",
          "return unsubscribe: 0 listeners, 0 callbacks, ≈0 ms at every level.",
          "While a handler runs, everything else on the JS thread waits."
        ],
        "note": "Теперь посмотрим на цену этой ошибки. По горизонтали — число визитов, по вертикали —\nвремя синхронной JS-обработки одного обновления. Оранжевые столбцы — вариант без\nочистки, среднее четырёх запусков. Белые точки — среднее отдельного запуска:\nв каждом мы отправляли по десять событий.\n\nПосле одного визита — около 0,45 миллисекунды на обновление. После десяти —\nоколо 4,3. После тридцати — около 12,4. Экран уже закрыт, но от его имени\nвыполняется всё больше работы.\n\nИсправление — вернуть очистку из useEffect. Для показанного emitter это\nreturn () => listeners.delete(onOrderUpdate). Если API подписки возвращает\nunsubscribe, возвращаем её. Зелёные столбцы — тот же опыт после исправления:\nноль оставшихся подписчиков, ноль вызовов закрытых экранов, время около нуля.\n\nПочему это относится к опыту пользователя? Пока выполняется эта синхронная\nработа, другая работа JS-потока ожидает — в том числе обработка ввода, если он\nпришёл в этот момент. Мы нашли механизм скрытой фоновой работы, который нельзя\nоценить только по рендерам React. Задержку конкретного нажатия этим графиком\nмы не измеряем.\n\nПоказать [график](../graph/src/assets/measurements/RN-subscription-chart.svg).\nСначала провести взглядом по оранжевым значениям 0,45 → 4,3 → 12,4 мс,\nзатем по зелёным нулевым счётчикам. Белая точка — один прогон, не одно событие.\nПунктир 16,7 мс — ориентир длительности кадра 60 Hz, не порог, по которому\nмы посчитали пропущенные кадры.\n\nДля вопросов: среднее на 30 посещениях по разным запускам — 11,7–13,1 мс;\nмаксимальное отдельное событие — 19,8 мс. Средние столбцы не равны максимумам.\nCleanup включает накладные расходы пустого обхода и измерения, поэтому ≈0,\nа не утверждение о математически нулевом времени. Native-driver анимации,\nпоказ кадров и доказанная прибавка к задержке касания не измерены. Четыре\nлокальных запуска показывают повторяемость модели на этом симуляторе.\nИсходные суммы десяти событий после 30 посещений: 131,103; 116,803; 121,064;\n128,738 мс. Числа графика и полные ограничения — в исследовании.\n\nПолный рассказ: speaker-guide/investigation-02-subscriptions.md. Источник: research/06-rn-subscription-pilot.md."
      }
    },
    {
      "id": "rn-subscription-production",
      "title": "Watch the count over the session",
      "subtitle": "The release question: do inactive screens keep subscriptions?",
      "size": "lg",
      "x": 240,
      "y": 8300,
      "chips": [
        {
          "label": "Investigation 02 · React Native"
        }
      ],
      "badge": {
        "label": "02 · React Native",
        "tone": "amber"
      },
      "detail": {
        "image": sessionCountCard,
        "bullets": [
          "Count active subscriptions and event deliveries at a stable boundary.",
          "Compare by screen lifecycle, app version and session stage.",
          "Export aggregate metrics through OpenTelemetry to a compatible backend."
        ],
        "note": "Как заметить возвращение проблемы после релиза? В коротком тесте экран могут открыть\nодин раз. А ошибка проявляется по мере повторных посещений. Значит, полезно наблюдать\nактивные подписки и число доставок события в контексте жизненного цикла экрана.\n\nСначала определяем ожидаемое число: например, когда экранов-потребителей нет, эти\nподписки должны исчезнуть. Затем агрегируем измерения по версии приложения и этапу\nсессии. OpenTelemetry может быть границей между нашей инструментацией и совместимым\nbackend. Конкретный vendor здесь не меняет вопрос: почему у закрытых экранов осталась\nработа?\n\nЭто предложение для production-наблюдения; в этом RN-опыте OTLP-доставка и алерт\nпока не проверены. Точный listeners.size доступен у нашего emitter. Для стороннего\nисточника нужен собственный учёт subscribe/unsubscribe. Не обещать универсальный\nдоступ к внутренним слушателям AppState или произвольной библиотеки.\n\nЭто и есть полезная связка инструментов: профиль показал место затрат, счётчик\nобъяснил их количество, повтор опыта проверил исправление. Прежде чем ускорять\nодно выполнение, стоит спросить, должно ли оно вообще происходить столько раз.\n\nПереход к следующему блоку: после релиза нам нужны наблюдения реальных сессий.\nА до релиза — проверка, которая не даст вернуть ту же ошибку. Дальше закрепим\nисправления двух расследований в CI. Не обещать здесь уже работающий RN OTLP\npipeline или алерт: этот блок описывает предлагаемый сигнал для production.\n\nПолный рассказ: speaker-guide/investigation-02-subscriptions.md. Источник: research/06-rn-subscription-pilot.md."
      }
    },
    {
      "id": "ci-profile-once",
      "title": "Profile once. Check every pull request.",
      "subtitle": "A profile explains the cause. A check stops it from coming back.",
      "size": "lg",
      "x": 2280,
      "y": 8300,
      "chips": [
        {
          "label": "Measurement culture"
        }
      ],
      "badge": {
        "label": "03 · Keep it fixed",
        "tone": "amber"
      },
      "detail": {
        "image": "",
        "bullets": [
          "Check behaviour and counts, not milliseconds: CI runners are noisy, these are not.",
          "Investigation 01 → an early click must sort the visible catalog.",
          "Investigation 02 → a closed screen must leave 0 subscriptions.",
          "Both checks fail on the bug and pass on the fix — 3 / 3 locally."
        ],
        "note": "Речь\nОба расследования закончились исправлением. Но исправление живёт до следующего рефакторинга: кто-то вернёт обычный module, кто-то напишет ещё один useEffect без очистки. Профиль объясняет причину один раз. Чтобы она не вернулась, нужна проверка, которая запускается на каждом pull request.\n\nИ главное правило: в CI проверяем поведение и счётчики, а не миллисекунды. Время на CI-раннерах шумит, тест на «12 ms» будет то падать, то проходить, и его отключат через неделю. А «клик сработал» и «подписчиков ноль» не шумят.\n\nПодготовка и источники\nПроверено 20 ноября 2026 локально: каждая проверка 3 / 3 прошла на исправленной версии и 3 / 3 упала на версии с багом (Chrome 157, Node 24). Сам workflow на GitHub не запускался. Веб-проверка обобщает локальный PASS/FAIL из карточки web-streaming-regression. Исходники: ci-template/."
      }
    },
    {
      "id": "ci-checks",
      "title": "Two checks. Both fail on the bug.",
      "subtitle": "Vitest + Testing Library for the hook · Playwright for the page",
      "size": "lg",
      "x": 4320,
      "y": 8300,
      "chips": [
        {
          "label": "Measurement culture"
        }
      ],
      "badge": {
        "label": "03 · Keep it fixed",
        "tone": "amber"
      },
      "detail": {
        "image": "",
        "bullets": [
          "The hook: open and close the screen 30 times, then count subscribers.",
          "The page: click before the rest of the page arrives, expect the sorted result."
        ],
        "note": "Речь\nВот обе проверки целиком — по три строки. Первая открывает и закрывает экран тридцать раз и считает подписчиков. На версии с багом она падает с сообщением «expected 30 to be 0»: ровно тридцать забытых подписок. Вторая нажимает кнопку, пока остальная страница ещё грузится, и ждёт сортировку. На версии с обычным module она падает: «Original order».\n\nОбратите внимание: Lighthouse этим двум версиям ставит одинаковые 100. Различает их только проверка поведения.\n\nПодготовка и источники\nci-template/hook/subscriptions.test.tsx (vitest 4.1.11, @testing-library/react 16.3.3, jsdom) и ci-template/web/early-click.spec.ts (@playwright/test 1.65.0). Баг включается переменными HOOK=leaky и SCRIPT=module. Тест хука запускается в jsdom; в RN-приложении — renderHook из @testing-library/react-native, сам хук тот же (в RN не проверялось).",
        "code": {
          "lang": "ts",
          "text": "// 02 · the hook\nfor (let visit = 0; visit < 30; visit++)\n  renderHook(() => useOrderUpdates(onUpdate)).unmount()\nexpect(orderUpdates.listenerCount()).toBe(0)\n//   bug → AssertionError: expected 30 to be 0\n\n// 01 · the early click\nawait page.goto('/', { waitUntil: 'commit' })\nawait page.getByRole('button', { name: 'Price: low to high' }).click()\nawait expect(page.getByRole('status')).toHaveText('Sorted by price')\n//   bug → Expected \"Sorted by price\", Received \"Original order\""
        }
      }
    },
    {
      "id": "ci-template",
      "title": "Take the template",
      "subtitle": "One workflow, on every pull request",
      "size": "lg",
      "x": 6360,
      "y": 8300,
      "chips": [
        {
          "label": "Measurement culture"
        }
      ],
      "badge": {
        "label": "03 · Keep it fixed",
        "tone": "amber"
      },
      "detail": {
        "image": "",
        "bullets": [
          "Copy ci-template/ into your repo; the workflow goes to .github/workflows/.",
          "React Native: the same hook check with @testing-library/react-native.",
          "After release: export the same counters through OpenTelemetry and watch them grow with session length."
        ],
        "note": "Речь\nЭто третье, что я обещал в начале: шаблон, который можно забрать. Одна папка, один workflow, две проверки. Возьмите своё расследование, найдите в нём поведение или счётчик, который должен оставаться верным, — и превратите его в проверку на каждый pull request.\n\nА после релиза — те же счётчики через OpenTelemetry: число подписок или «клик без результата» по версиям и длине сессии. CI ловит регрессию до релиза, наблюдение — то, что CI не воспроизвёл.\n\nПодготовка и источники\nci-template/performance-checks.yml, README.md там же. Workflow на GitHub не запускался — если спросят, так и сказать. Ссылку/QR на шаблон добавить, когда будет публичный адрес.",
        "code": {
          "lang": "yaml",
          "text": "name: performance checks\non: [pull_request]\njobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with: { node-version: 24 }\n      - run: npm ci\n      # mobile (React Native) — and web\n      - run: npm run test:hook   # 0 subscriptions\n      # web only — not needed in an RN repo\n      - run: npx playwright install --with-deps chromium\n      - run: npm run test:web    # the early click works"
        }
      }
    },
    {
      "id": "toolkit-map",
      "title": "Which tool answers which question?",
      "subtitle": "Start from the user question. Then open the tool that can see it.",
      "size": "lg",
      "x": 8400,
      "y": 8300,
      "chips": [
        {
          "label": "Toolkit"
        }
      ],
      "badge": {
        "label": "Toolkit",
        "tone": "amber"
      },
      "detail": {
        "image": toolkitMapCard,
        "bullets": [
          "Lighthouse → the load, in lab conditions; not actions after load.",
          "Custom instrumentation → your endpoint and counts; not why it is slow.",
          "Chrome DevTools Performance → browser work; not whether the action worked.",
          "React DevTools Profiler → React commits; not JS outside rendering.",
          "Hermes sampling profiler → JS time by function; not call counts or user latency.",
          "Flashlight → Android frames, CPU, RAM; not shown today.",
          "OpenTelemetry → your measurements after release; it does not choose the metric."
        ],
        "note": "Речь\nСоберём инструменты в одну шпаргалку. Начинаем не с инструмента, а с вопроса.\n\nХорошо ли загрузилась страница — Lighthouse; но действия после загрузки он не видит, это был наш первый кейс. Сработало ли действие и когда — только своя инструментация: обработчик клика, наблюдение за DOM, счётчик подписчиков. Она отвечает «что», но не «почему». Что выполнялось в браузере — Chrome DevTools Performance; он показал порядок, но не то, отсортировался ли список. Что рендерил React — React DevTools Profiler; работу вне рендера он не видит, как в RN-кейсе. Куда уходит JS-время в React Native — Hermes; он показывает функции по времени, но не число вызовов. Отсюда и счётчик.\n\nFlashlight — для Android: кадры, CPU и память по сценарию на устройстве. Сегодня я его не показывал: наши лаборатории были в Chrome и в iOS Simulator. И OpenTelemetry — чтобы ваши измерения продолжали приходить после релиза; какую метрику мерить, он за вас не выберет.\n\nПодготовка и источники\nКаждая строка, кроме Flashlight, опирается на карточку этого доклада: Lighthouse — web-streaming-lighthouse; инструментация — web-streaming-diagnosis, rn-subscription-counter; Chrome DevTools — web-streaming-devtools; React DevTools — rn-subscription-react; Hermes — rn-subscription-hermes; OTel — web-streaming-observability, rn-subscription-production. Flashlight: Android-инструмент (github.com/bamlab/flashlight); прогона в этом докладе нет — не говорить, что мы его запускали. Картинка: research/talk-figures.mjs → Toolkit-map.svg."
      }
    },
    {
      "id": "thank-you",
      "title": "Thank you!",
      "subtitle": "LinkedIn · andreitazetdinov.com",
      "size": "lg",
      "x": 240,
      "y": 9900,
      "chips": [
        {
          "label": "Thank you"
        }
      ],
      "badge": {
        "label": "Thank you · Q&A",
        "tone": "amber"
      },
      "detail": {
        "image": thankYouCard,
        "bullets": [
          "LinkedIn: linkedin.com/in/andrei-tazetdinov",
          "Website: andreitazetdinov.com",
          "Questions?"
        ],
        "note": "Спасибо. Слайды, код проверок и измерения выложу в LinkedIn и на сайте — QR-коды здесь. Этот слайд остаётся на экране во время вопросов.\n\nQR проверены распознаванием (macOS CoreImage) 21 ноября 2026: https://www.linkedin.com/in/andrei-tazetdinov/ и https://andreitazetdinov.com. Картинка: research/talk-figures.mjs → Thank-you.svg."
      }
    },
    {
      "id": "slide-A1",
      "title": "React Native: callback cadence is one observable",
      "subtitle": "Source: ios-cadence-1794441662289; diagnostic corroboration ios-system-1794455821579. Boundary: Simulator functional evidence; no physical smoothness or dropped-frame conclusion.",
      "size": "lg",
      "x": 2280,
      "y": 9900,
      "chips": [
        {
          "label": "A1",
          "mono": true
        }
      ],
      "badge": {
        "label": "Presentation unavailable",
        "tone": "amber"
      },
      "detail": {
        "bullets": [
          "Release / Hermes on iOS Simulator:",
          "Native callback acquisition continued during selected blocked JS work.",
          "Native presentation / hitches: unavailable in the retained Simulator hitch probe."
        ],
        "note": "Timing: Q&A only (25:00–30:00); no extra slot. Open only for a relevant native question; preserve unavailable presentation and stop by 30:00.\n\n“The app-local CADisplayLink buffer acquires without calling JS per callback. Raw native timestamps and pre/post\nclock pairs are retained. The constant-offset model permits a conditional count inside the selected JS bracket;\ntransport half-width is not a complete precision or drift bound.”\n\n“The system recording matches callback signposts and includes separate JS/Hermes CPU sampling. The signposts share\nthe callback source; they are not an independent compositor sensor. Animation Hitches was unsupported on this\nSimulator. Its count and ratio stay unavailable. A real native-jank or smooth-FPS claim still needs supported\nphysical Release evidence, source validation and the declared repeated comparison.”\n\nEvidence cue\nNative source and clocks (IOS_NATIVE_CADENCE.md), original unsupported hitch probe/system artifacts (IOS_SYSTEM_PROFILER_GATE.md).\nUse the retained standalone system analysis if available. Do not turn callback spacing into presented-frame FPS.\nD is a functional appendix here; E native-jank acceptance remains open."
      }
    },
    {
      "id": "slide-A2",
      "title": "Runner outcome and archive state are separate",
      "subtitle": "Sources: maestro-1794559097407-1a14dc, maestro-1794559119640-609fd2. Endpoint: JS scheduling and native callback proxy; presentation unavailable.",
      "size": "lg",
      "x": 4320,
      "y": 9900,
      "chips": [
        {
          "label": "A2",
          "mono": true
        }
      ],
      "badge": {
        "label": "Runner ≠ archive state",
        "tone": "amber"
      },
      "detail": {
        "bullets": [
          "Original completion assertion — Scenario outcome: passed; Telemetry archive: finalized",
          "Deliberately wrong completion assertion — Scenario outcome: failed; Telemetry archive: finalized"
        ],
        "note": "Timing: Q&A only (25:00–30:00); no extra slot. Open only for a relevant runner/archive question; keep the answer inside the remaining Q&A time.\n\n“Maestro actually triggers the app and checks completion. The negative scenario intentionally fails its UI assertion,\nwhile the app's telemetry can still be completely archived. Finalization does not make the runner pass.\nThe harness preserves both results with original JUnit, command evidence, app receipts and raw OTLP.\nRunner action time is not app CPU, touch latency or a frame metric. This is Simulator integration evidence,\nnot a repeated native performance result.”\n\nEvidence cue\nMaestro contract and negative flow (MAESTRO_GATE.md). Open the two reports separately using the demo-plan recipe;\nshow the failed scenario with its finalized archive in the same screen. If appendix time is unavailable, keep this\nas a question-and-answer example rather than displacing a core comparison."
      }
    }
  ],
  "edges": [
    {
      "from": "slide-01",
      "to": "about-me"
    },
    {
      "from": "about-me",
      "to": "gdg-linz"
    },
    {
      "from": "gdg-linz",
      "to": "performance-question"
    },
    {
      "from": "performance-question",
      "to": "user-waits"
    },
    {
      "from": "user-waits",
      "to": "framework-map"
    },
    {
      "from": "framework-map",
      "to": "framework-proxies"
    },
    {
      "from": "framework-proxies",
      "to": "framework-choice"
    },
    {
      "from": "framework-choice",
      "to": "web-early-action-story"
    },
    {
      "from": "web-early-action-story",
      "to": "web-streaming-lighthouse"
    },
    {
      "from": "web-streaming-lighthouse",
      "to": "web-streaming-diagnosis"
    },
    {
      "from": "web-streaming-diagnosis",
      "to": "web-streaming-devtools"
    },
    {
      "from": "web-streaming-devtools",
      "to": "web-streaming-mechanism"
    },
    {
      "from": "web-streaming-mechanism",
      "to": "web-streaming-comparison"
    },
    {
      "from": "web-streaming-comparison",
      "to": "web-streaming-takeaway"
    },
    {
      "from": "web-streaming-takeaway",
      "to": "web-streaming-frameworks"
    },
    {
      "from": "web-streaming-frameworks",
      "to": "web-streaming-observability"
    },
    {
      "from": "web-streaming-observability",
      "to": "web-streaming-regression"
    },
    {
      "from": "web-streaming-regression",
      "to": "transition-to-native"
    },
    {
      "from": "transition-to-native",
      "to": "framework-native"
    },
    {
      "from": "framework-native",
      "to": "rn-subscription-scene"
    },
    {
      "from": "rn-subscription-scene",
      "to": "rn-subscription-react"
    },
    {
      "from": "rn-subscription-react",
      "to": "rn-subscription-hermes"
    },
    {
      "from": "rn-subscription-hermes",
      "to": "rn-subscription-counter"
    },
    {
      "from": "rn-subscription-counter",
      "to": "rn-subscription-fix"
    },
    {
      "from": "rn-subscription-fix",
      "to": "rn-subscription-production"
    },
    {
      "from": "rn-subscription-production",
      "to": "ci-profile-once"
    },
    {
      "from": "ci-profile-once",
      "to": "ci-checks"
    },
    {
      "from": "ci-checks",
      "to": "ci-template"
    },
    {
      "from": "ci-template",
      "to": "toolkit-map"
    },
    {
      "from": "toolkit-map",
      "to": "thank-you"
    },
    {
      "from": "thank-you",
      "to": "slide-A1",
      "kind": "dashed",
      "label": "Q&A"
    },
    {
      "from": "thank-you",
      "to": "slide-A2",
      "kind": "dashed",
      "label": "Q&A"
    }
  ],
  "steps": [
    {
      "id": "slide-01",
      "focus": [
        "slide-01"
      ],
      "part": "Main talk",
      "caption": "Start with the interaction. Name the endpoint."
    },
    {
      "id": "about-me",
      "focus": [
        "about-me"
      ],
      "part": "Opening",
      "caption": "Who is talking"
    },
    {
      "id": "gdg-linz",
      "focus": [
        "gdg-linz"
      ],
      "part": "Opening",
      "caption": "GDG Linz"
    },
    {
      "id": "performance-question",
      "focus": [
        "performance-question"
      ],
      "part": "Introduction · Why these metrics",
      "caption": "Start with the mismatch between an internal observation and the task a person is trying to complete."
    },
    {
      "id": "user-waits",
      "focus": [
        "user-waits"
      ],
      "part": "Theory · User experience",
      "caption": "Describe the user experience before selecting a measurement."
    },
    {
      "id": "framework-map",
      "focus": [
        "framework-map"
      ],
      "part": "Web · Measurement boundaries",
      "caption": "Translate the user question into an explicit start, endpoint and source."
    },
    {
      "id": "framework-proxies",
      "focus": [
        "framework-proxies"
      ],
      "part": "Web · Metrics framework",
      "caption": "Each number has a scope. We can now separate the result we want from evidence about its cause."
    },
    {
      "id": "framework-choice",
      "focus": [
        "framework-choice"
      ],
      "part": "Theory · Measurement framework",
      "caption": "Synthesis: user question → measured outcome → cause → repeated comparison."
    },
    {
      "id": "web-early-action-story",
      "focus": [
        "web-early-action-story"
      ],
      "part": "Investigation 01 · Web",
      "caption": "A controlled React example · What does the user actually experience?"
    },
    {
      "id": "web-streaming-lighthouse",
      "focus": [
        "web-streaming-lighthouse"
      ],
      "part": "Investigation 01 · Web",
      "caption": "Lighthouse 13.6 · desktop preset · local · it scores the load, not the action"
    },
    {
      "id": "web-streaming-diagnosis",
      "focus": [
        "web-streaming-diagnosis"
      ],
      "part": "Investigation 01 · Web",
      "caption": "Local diagnostic run · DOM observations, not production telemetry or a hydration-duration measurement."
    },
    {
      "id": "web-streaming-devtools",
      "focus": [
        "web-streaming-devtools"
      ],
      "part": "Investigation 01 · Web",
      "caption": "Existing lab trace opened in Chrome DevTools · separate run from the marker run"
    },
    {
      "id": "web-streaming-mechanism",
      "focus": [
        "web-streaming-mechanism"
      ],
      "part": "Investigation 01 · Web",
      "caption": "This is the mechanism we tested; script timing is not hydration cost."
    },
    {
      "id": "web-streaming-comparison",
      "focus": [
        "web-streaming-comparison"
      ],
      "part": "Investigation 01 · Web",
      "caption": "Controlled local experiment · 3 s artificial delay · not production data."
    },
    {
      "id": "web-streaming-takeaway",
      "focus": [
        "web-streaming-takeaway"
      ],
      "part": "Investigation 01 · Web",
      "caption": "Lab result: six pairs · No claim about production frequency or hydration duration."
    },
    {
      "id": "web-streaming-frameworks",
      "focus": [
        "web-streaming-frameworks"
      ],
      "part": "Investigation 01 · Web",
      "caption": "Checked: Next.js 16.3.8 production HTML · other frameworks not checked"
    },
    {
      "id": "web-streaming-observability",
      "focus": [
        "web-streaming-observability"
      ],
      "part": "Investigation 01 · Web",
      "caption": "Local experiment · browser → JSON receiver → Node OTel SDK → OTLP receiver."
    },
    {
      "id": "web-streaming-regression",
      "focus": [
        "web-streaming-regression"
      ],
      "part": "Investigation 01 · Web",
      "caption": "Three pairs · artificial delay · local exit codes 0 and 1 · not a production budget."
    },
    {
      "id": "transition-to-native",
      "focus": [
        "transition-to-native"
      ],
      "part": "Transition · React Native",
      "caption": "The user journey remains the starting point."
    },
    {
      "id": "framework-native",
      "focus": [
        "framework-native"
      ],
      "part": "React Native · Metrics framework",
      "caption": "Native launch, touch response and native frames need their own boundaries."
    },
    {
      "id": "rn-subscription-scene",
      "focus": [
        "rn-subscription-scene"
      ],
      "part": "Investigation 02 · React Native",
      "caption": "A deliberately introduced subscription leak · iOS Simulator · Hermes"
    },
    {
      "id": "rn-subscription-react",
      "focus": [
        "rn-subscription-react"
      ],
      "part": "Investigation 02 · React Native",
      "caption": "Debug build · qualitative · timings not comparable to the Release numbers"
    },
    {
      "id": "rn-subscription-hermes",
      "focus": [
        "rn-subscription-hermes"
      ],
      "part": "Investigation 02 · React Native",
      "caption": "Hermes Debug samples · selected 20 ms interval · focused on the handler subtree"
    },
    {
      "id": "rn-subscription-counter",
      "focus": [
        "rn-subscription-counter"
      ],
      "part": "Investigation 02 · React Native",
      "caption": "Controlled lab scene · all screens closed before the event stream"
    },
    {
      "id": "rn-subscription-fix",
      "focus": [
        "rn-subscription-fix"
      ],
      "part": "Investigation 02 · React Native",
      "caption": "Four local Release runs · mean of 10 events per run · JS handler time, not measured user latency"
    },
    {
      "id": "rn-subscription-production",
      "focus": [
        "rn-subscription-production"
      ],
      "part": "Investigation 02 · React Native",
      "caption": "Proposed production instrumentation · not yet validated in production"
    },
    {
      "id": "ci-profile-once",
      "focus": [
        "ci-profile-once"
      ],
      "part": "Measurement culture",
      "caption": "Measurement culture · turn each investigation into a check"
    },
    {
      "id": "ci-checks",
      "focus": [
        "ci-checks"
      ],
      "part": "Measurement culture",
      "caption": "Real failure messages from the local runs · 3 / 3 fail on the bug, 3 / 3 pass on the fix"
    },
    {
      "id": "ci-template",
      "focus": [
        "ci-template"
      ],
      "part": "Measurement culture",
      "caption": "ci-template/performance-checks.yml · verified locally, not yet run on GitHub"
    },
    {
      "id": "toolkit-map",
      "focus": [
        "toolkit-map"
      ],
      "part": "Toolkit",
      "caption": "Toolkit · each row was used in today's cases, except Flashlight",
      "jump": {
        "to": "framework-choice",
        "exit": "thank-you"
      }
    },
    {
      "id": "thank-you",
      "focus": [
        "thank-you"
      ],
      "part": "Closing",
      "caption": "Slides, code and measurements will be posted on LinkedIn and the website",
      "next": null
    },
    {
      "id": "slide-A1",
      "focus": [
        "slide-A1"
      ],
      "part": "Appendix · Q&A",
      "caption": "Sources, endpoints and limitations travel with the result.",
      "returnToStep": "thank-you"
    },
    {
      "id": "slide-A2",
      "focus": [
        "slide-A2"
      ],
      "part": "Appendix · Q&A",
      "caption": "Sources, endpoints and limitations travel with the result.",
      "returnToStep": "thank-you"
    }
  ]
};
