# From Profiler to Production — полный текст с таймингом

Слот 30 минут: текст рассчитан на **≈20:00**, до 25:00 — запас, дальше вопросы. Текст на английском — его говорить;
ремарки по-русски — для тебя. Время в заголовке — от начала доклада, в скобках — сколько на карточку.
±минута на карточку — нормально; смотри только на контрольные точки:

| Контрольная точка | Карточка | Время |
| --- | --- | --- |
| Начало веб-кейса | 9 · The page is visible | 4:20 |
| Начало RN | 19 · From browser to mobile | 10:20 |
| Начало CI | 27 · Profile once | 15:50 |
| Финал | 32 · Thank you | 19:40 |

Отстаёшь больше чем на минуту на контрольной точке — сокращай карточки, помеченные **[можно коротко]**.

Цифры в тексте — из заметок к карточкам; источники там же. Две карточки ждут твоих слов: **[ТВОЯ ФРАЗА]**.

---

## Открытие

### 1 · From Profiler to Production
`slide-01` · **0:00 → 0:25** (0:25)

Hi everyone. This talk is called "From Profiler to Production". In the next twenty minutes I want to give you
three things: a way to choose metrics that reflect what the user actually experiences, a feel for which profiler
answers which question — and a CI template you can take home today.

### 2 · About me
`about-me` · **0:25 → 1:05** (0:40)

My name is Andrei. I work on the Dynatrace React Native agent — SDK-level instrumentation that runs inside
production apps. So my daily question is not "is this app fast?", but "what exactly are we measuring, and does it
mean what we think it means?" Everything I show today is a controlled lab case — real tools, real numbers,
but not customer data.

### 3 · GDG Linz
`gdg-linz` · **1:05 → 1:25** (0:20)

I also co-organise GDG Linz — meetups, talks, workshops. If you're around Linz, come by. Or better — come and speak.

---

## Как выбирать метрику

### 4 · The report looks fast. What did the user experience?
`performance-question` · **1:25 → 2:05** (0:40)

We all have dashboards full of good numbers. Green scores, small bundles, short renders. And still users tell us
the app feels slow. Usually nobody is lying — the number just answers a different question than the user is asking.
A page can appear before its buttons work. An animation can be smooth while a tap goes nowhere.
So before we trust a number, we ask: which user question does it answer?

### 5 · Which wait are we measuring?
`user-waits` · **2:05 → 2:45** (0:40)

"Fast" hides at least three questions. Opening: when can I start using the screen? Acting: when do I see the right
result of my tap or click? Moving: does scrolling or animation keep going? These are three different properties.
A screen can appear quickly and respond late. It can respond and still stutter. One number cannot stand in for all three.

*(провести рукой по трём панелям)*

### 6 · Web: three questions, different measurements
`framework-map` · **2:45 → 3:25** (0:40) **[можно коротко]**

On the web, each question needs its own start, end and source. Opening: from navigation to a usable state — and
"usable" means an action actually works. Acting: from the input to the correct result on screen. Moving: frame timing
during that scroll. One note on TTI: Time to Interactive was a specific Lighthouse lab metric, and it was removed
in Lighthouse 10. Your own "app ready" marker is a different measurement — name it as such.

### 7 · What can this number prove?
`framework-proxies` · **3:25 → 4:05** (0:40)

Three numbers we all optimise. Lighthouse score — it audits the load, under its conditions; it never tests what
happens after. Bundle size — that's code volume; what matters is the work that actually executes. React render
duration — that's rendering in the profiled tree; there is other work on the way to the screen.
These numbers are useful. They become vanity targets when we improve them and call it a user win without checking
the user's outcome.

### 8 · Choose the metric. Find the cause. Verify the gain.
`framework-choice` · **4:05 → 4:20** (0:15)

So the loop for today: choose the outcome the user waits for. Profile to find a cause. Then repeat the same task
and verify the gain. Let's apply it.

---

## Расследование 01 · Web

### 9 · The page is visible. Is the action ready?
`web-early-action-story` · **4:20 → 4:50** (0:30)

A small catalog, server-rendered and streamed. The products and the sort button arrive in the first chunk of HTML.
A recommendations block below is still loading. The user clicks "Price: low to high". The recommendations have
nothing to do with sorting. So — what happens?

*(пауза, дать залу подумать)*

### 10 · Lighthouse: 100. The click is still lost.
`web-streaming-lighthouse` · **4:50 → 5:30** (0:40)

First, the standard report. This is exactly the variant where the early click is lost. Lighthouse: 100.
FCP and LCP 0.2 seconds, total blocking time zero. The report is not lying — the page really did show content fast
and did not block. It answers another question: Lighthouse loads the page and scores the load. It never clicks.
Our user did.

### 11 · Which events explain the missing action?
`web-streaming-diagnosis` · **5:30 → 6:10** (0:40)

So we recorded the user's path ourselves. A document click listener saw the click at about 785 milliseconds —
and no sort after it. A MutationObserver saw the recommendations arrive at about 3 seconds. And a marker in our
client entry says the app code started at 3037 milliseconds. At the moment of the click, the app code had not even started.

### 12 · The real profiler: the click came first.
`web-streaming-devtools` · **6:10 → 6:50** (0:40)

You don't need our markers to see this. Same scene, Chrome DevTools, Performance tab — a separate recording.
The click is at 748 milliseconds, there on the Interactions track. Our client.js — "Evaluate module" — runs at about
3 seconds. Same order: click first, app code later.

And look at the left: INP, 10 milliseconds, green. The browser handled the event quickly — there was just nothing
to handle it. That's the second green metric on a lost click.

### 13 · Could the rest of the page delay the button?
`web-streaming-mechanism` · **6:50 → 7:30** (0:40)

Why so late? The HTML streams in parts. But a regular `<script type="module">` waits until the document has
finished parsing. And our document stays open until the late recommendations arrive. So the code for the visible
catalog waits for the invisible part of the page. Hypothesis: load the same entry as an `async` module, and it runs
as soon as it's downloaded. But an earlier script is not the goal — the click is. So we test the click again.

### 14 · Same early click. Different result.
`web-streaming-comparison` · **7:30 → 8:10** (0:40)

Both screenshots: recommendations still loading. Left, the regular module: the order did not change.
Right, async: sorted, while the late block still hasn't arrived. Not one lucky run — six runs per variant,
alternating order. Regular module: the early click was lost six out of six. Async: six out of six sorted.

### 15 · Visible content is not a working action.
`web-streaming-takeaway` · **8:10 → 8:40** (0:30)

In both variants the button was visible. Visible did not mean working. Our outcome was never "the button appeared"
or "the script ran" — it's the correct order after the click. Script timing helped find the cause.
And async is a candidate, not a universal fix: check your script dependencies before you copy it.

### 16 · Why Next.js already does this
`web-streaming-frameworks` · **8:40 → 9:10** (0:30) **[можно коротко]**

If you use Next.js, you're thinking: we don't have this. You're right. I built a Next.js 16 production app and
looked at the HTML: all client chunks load with `async`. The framework already made this fix. This case explains why —
and what breaks when you stream SSR yourself with a plain module entry. Lighthouse will still say 100.

### 17 · How could we see this after release?
`web-streaming-observability` · **9:10 → 9:45** (0:35) **[можно коротко]**

After release, a collector that loads with the late React code would miss this click too. So we tried a tiny early
listener: it records the attempt and waits for confirmation that the sort really happened. Reports go through
OpenTelemetry to a backend. An attempt without a confirmed result stays "unknown" — not success, not failure.

### 18 · Can the measurement catch the regression?
`web-streaming-regression` · **9:45 → 10:20** (0:35)

And the same signal works as a check. We fixed a rule in advance and ran three pairs. Async: three of three actions
confirmed in time — pass. Regular module: zero of three — fail, exit code one. An exit code is something CI understands.
We'll come back to that. The window and the delay are lab choices, not a production budget.

---

## Расследование 02 · React Native

### 19 · From browser to mobile: follow the user
`transition-to-native` · **10:20 → 10:40** (0:20)

On the web, visible did not mean ready. Now mobile. Same idea — start from the user — but new boundaries and new tools.

### 20 · React Native: ready, responsive, smooth?
`framework-native` · **10:40 → 11:15** (0:35)

The same three questions in React Native. Ready: from native launch to a usable screen — cold and warm starts are
different. Responsive: from the touch to the correct result on screen; a JS callback is only a checkpoint on the way.
Smooth: native frame timing. And JS thread stalls we inspect separately. Today's case is about the JS thread.

### 21 · The screen is gone. What keeps running?
`rn-subscription-scene` · **11:15 → 12:00** (0:45)

Here's the question turned around: if a screen is gone, has its work stopped? An orders screen. On mount, a
`useEffect` subscribes to order updates. Each update: find the order, update it, sort the list of 500 orders, set state.
Just remember this hook — we'll come back to it.

The experiment: open the screen and close it — one, ten, thirty times. Then, with every screen closed, send ten
order updates. What should run on behalf of a closed screen?

*(указать на useEffect и subscribe; исправление пока не раскрывать)*

### 22 · React: no renders from the closed screen.
`rn-subscription-react` · **12:00 → 12:45** (0:45)

The React developer's first tool: React DevTools Profiler. This is a real recording of this scene, after thirty
visits. When the update stream starts, App re-renders its buttons and texts — that's this commit. The orders screen
is not in the list. All thirty are closed; React has nothing of theirs to render. And during the ten updates —
no new commits. If you look only at renders, everything looks fine. But no render is not the same as no work.
Is JavaScript still running?

*(не говорить «профайлер пустой» — App рендерился; это Debug-сборка, 3.5 ms не сравнивать)*

### 23 · Hermes: the sort is expensive. Optimize it?
`rn-subscription-hermes` · **12:45 → 13:25** (0:40)

So we open a different profiler: Hermes, the JS engine's sampling profiler. And there it is: `onOrderUpdate`, and
under it, `arrayPrototypeSort`. JavaScript is running — for a screen that's gone. The obvious idea: the sort is
expensive, let's make it faster. But this picture can't answer one question: how many times does this handler run
for a single update? A sampling profiler shows where time goes — not how many calls.

### 24 · One update. Thirty callbacks.
`rn-subscription-counter` · **13:25 → 14:15** (0:50)

So we add the simplest instrument there is — a counter. Subscribers after one visit: one. After ten: ten.
After thirty: thirty. Open order screens: zero. One update — thirty handlers. Ten updates — three hundred calls.

Now back to the hook. `listeners.add` — and no cleanup. React would call the function you return from the effect
on unmount. Here nothing is returned. The subscription outlives the screen, and every visit adds one more.
That's why a faster sort would be the wrong fix: make one handler twice as fast, and the twenty-nine extra
handlers are still there.

### 25 · The screen is closed. Its handlers are not.
`rn-subscription-fix` · **14:15 → 15:10** (0:55)

Here's the cost. Horizontal: visits. Vertical: synchronous JS work per order update. Orange: no cleanup, mean of
four runs. After one visit — about half a millisecond per update. After ten — 4.3. After thirty — 12.4 milliseconds,
for screens that are closed. The dashed line is one 60 Hz frame, just for scale.

The fix is one line: return the cleanup from the effect — `return () => listeners.delete(onOrderUpdate)`, or return
the unsubscribe function your API gives you. Green: same experiment after the fix. Zero subscribers left,
zero calls, about zero milliseconds.

Why does the user care? While this runs, everything else on the JS thread waits — including handling a tap that
arrives at that moment. We measured the hidden work, not the delay of a specific tap.

*(провести взглядом: оранжевые 0.45 → 4.3 → 12.4, потом зелёные нули)*

### 26 · Watch the count over the session
`rn-subscription-production` · **15:10 → 15:50** (0:40)

How would you catch this after release? A short test opens the screen once — and one leaked listener costs nothing.
The problem grows with session length. So watch the count: active subscriptions, by screen lifecycle, app version
and session stage. Closed screens should leave zero. Export that through OpenTelemetry to your backend.

**[ТВОЯ ФРАЗА — 1–2 предложения: видел ли ты такой паттерн (подписки/слушатели, пережившие экран) в приложениях
через SDK. Если нет — пропусти.]**

*(это предложение для production, в RN OTLP-доставку мы не проверяли — не обещать работающий алерт)*

---

## Культура измерений · CI

### 27 · Profile once. Check every pull request.
`ci-profile-once` · **15:50 → 16:30** (0:40)

Both investigations ended with a fix. But a fix lives until the next refactor — someone brings back the plain
module, someone writes another `useEffect` without cleanup. A profile explains the cause once. A check keeps it
from coming back. And the main rule: in CI, check behaviour and counts, not milliseconds. CI runners are noisy —
a test on "12 milliseconds" will flake and be disabled within a week. "The click sorted" and "zero subscribers" don't flake.

### 28 · Two checks. Both fail on the bug.
`ci-checks` · **16:30 → 17:10** (0:40)

Here are both checks, a few lines each. The hook: open and close the screen thirty times, count subscribers.
On the buggy version it fails with "expected 30 to be 0" — exactly thirty forgotten subscriptions. The page:
click while the rest of the page is still loading, expect the sorted order. On the plain module it fails:
"Original order". And remember — Lighthouse gives both versions the same 100. Only the behaviour check tells them apart.

### 29 · Take the template
`ci-template` · **17:10 → 17:45** (0:35)

This is the third thing I promised. One folder, one workflow, two checks. Take your own investigation, find the
behaviour or the count that must stay true — and turn it into a check on every pull request. After release, send
the same counters through OpenTelemetry. CI catches the regression before release; observation catches what CI
didn't reproduce.

*(шаблон проверен локально, 3/3; workflow на GitHub не запускался — не говорить «это уже крутится у нас в CI»)*

---

## Итог

### 30 · Which tool answers which question?
`toolkit-map` · **17:45 → 18:50** (1:05)

Let's put the tools in one place — starting from the question, not the tool.
Did the page load well? Lighthouse — but it never sees actions after load. Did my action work, and when?
Only your own instrumentation can say: a listener, an observer, a counter. It tells you what, not why.
What ran on the main thread? Chrome DevTools Performance — order and cost, but not whether the result was correct.
What did React render? React DevTools Profiler — it doesn't see JS outside rendering. Where does JS time go in
React Native? Hermes — by function, but not how many calls; that's where the counter came in.
Frames, CPU and memory on Android? That's Flashlight — I didn't show it today; our labs were Chrome and the iOS Simulator.
And did it come back after release? OpenTelemetry to your backend — it carries your measurement, but it won't choose it for you.

*(Flashlight — честно «не показывал сегодня», не говорить, что запускали)*

### 31 · Make the performance statement inspectable
`slide-08` · **18:50 → 19:40** (0:50)

One last thing. Whenever you say "we made it faster", carry the context with the number: what was the start and
the end, and which tool saw them. Which build, which device, which workload. How many runs, and how much they varied.
Without that, a number is an opinion. And if you take one sentence home: start from what the user waits for —
then pick the tool that can actually see it.

*(старая заметка в карточке про Observer и F-протоколы не относится к этому докладу — её не читать)*

### 32 · Thank you!
`thank-you` · **19:40 → 20:00** (0:20)

Thank you! The slides, the checks and the measurements will be on my LinkedIn and my website — the QR codes are
right here. I'm happy to take questions.

*(оставить этот слайд на экране на всё время вопросов)*

---

Итог по времени: около 2050 слов — это ≈16 минут чистой речи при 130 словах в минуту; с переходами и паузами
получается разметка выше, ≈20:00. До 25:00 остаётся запас на [ТВОЮ ФРАЗУ], отступления и медленный темп;
последние 5 минут — вопросы. Реальное время покажет только прогон вслух с секундомером.
