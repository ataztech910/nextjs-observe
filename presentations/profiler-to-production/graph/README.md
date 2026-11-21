# Performance talk on the workshop graph engine

> **Content status — 17 November:** The viewer and introduction photos are available; the talk content remains a partial draft. The [fixed title, abstract and required experiments](../../../docs/research/performance-observability/CONFERENCE_BRIEF.md) govern completion. The existing evidence-only route does not yet fulfill that brief.

This is an independent copy of the engine from the sibling `workshop-slides` presentation, at commit
`2b4edfc073545d8d5aaa879c10dd392f874b748e`. The original deck stays in its original folder unchanged.
`ENGINE_ORIGIN.json` records all 24 copied files and their original hashes. PresenterNotes adds a scroll limit/paragraph preservation for the longer timing notes; NodeCard displays a focused
measurement image as a full frame. The other 22 copied engine files are byte-identical.
The React app entry, Vite setup, content generator and offline packer are new integration code.

For the Russian slide-by-slide speaking script and an explicit audit of missing conference scenes, start with
[speaker-guide/README.md](../speaker-guide/README.md). It describes the current cards without changing this deck;
proposed cuts are editorial decisions, not implemented slide changes.

## Start locally

From this folder, with Node 24 and Python 3.9+:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4349/**. This uses a strict, separate port. No other presentation or Observer server is stopped.
Dependencies install into this folder's own `node_modules`; there is no symlink to or runtime import from the old deck.

The copied engine provides the original gliding camera, graph cards/edges, overview zoom/pan, keyboard/swipe/wheel,
notes, fullscreen, elapsed display and gamepad integration. Gamepad support is inherited; physical controller testing
is not claimed by this migration. There is no timer attached to individual talk cards. The top bar shows elapsed page time, with no automatic talk-duration hard stop.

| Key | Action |
| --- | --- |
| → / Space / Page Down | Next; main route stops on 08 |
| ← / Page Up | Back through navigation history |
| O / Escape | Overview; click a card to focus it |
| N | Notes with elapsed timing targets |
| F | Fullscreen |
| Home | First step |
| ? | Original engine help |

Appendices A1/A2 are accessible from overview; Next returns them to 08. The current main counter has 19 steps (eight earlier talk cards, two opening photos, five introductory/theory cards, one RN framework card, two diagnostic mini-examples and one comparison card), excluding
appendices. Deep links use **`#step=slide-03`**, unlike the flat fallback's hash format. The engine maintains its own
navigation trail; it uses replaceState for its URL rather than creating browser-history entries for each step.
Notes overlay the same window, not a private presenter screen. Close them before projecting audience content.

## Content and standalone build

The title card now states the three [audience outcomes](../AUDIENCE_OUTCOMES.md) supplied on 19 November:
metric selection framework, practical profiling toolkit, and a usable CI template. They are promises and
acceptance requirements; the current draft does not claim the toolkit and CI demonstration are complete.

The [reviewed Markdown](../../../docs/research/performance-observability/CONFERENCE_SLIDES.md) supplies audience values,
source/endpoint/boundary text and full notes. `introduction.json` supplies the copied speaker/GDG opening cards.
`measurement-cards.json` overrides selected visual frames; `mini-examples.json` adds the shared three-step framework diagram, a Web proxy card, a separate RN
framework card and the mismatch/layout cards with images and speaker notes. The framework begins at
`#step=framework-choice`; its full map and speaking text are in [framework-metrics.md](../speaker-guide/framework-metrics.md).
The theory sequence starts at `#step=performance-question`: the measurement problem -> user waits ->
restored Web map -> proxy boundaries -> shared framework synthesis (`#step=framework-choice`).
The earlier user-wait and Web-map explanations are restored as separate cards.
The RN framework opens at `#step=framework-native` after the last Web example; its script is
[framework-native.md](../speaker-guide/framework-native.md). The shared diagram remains a separate synthesis after the preceding explanations.
Do not remove or merge explanatory slides to meet a timing target; delivery and cuts are Andrei's decision.
The RN framework covers only native boundaries; inconclusive-study details stay in preparation/Q&A.
The layout traces are followed by `#step=layout-framework-check`, showing all six predeclared
Event Timing comparison pairs (median 88 -> 64 ms, same output). These timings are separate from the traces.
See [comparison report](../web-case/LAYOUT_COMPARISON.md).
Its speaking script is [web-layout-framework.md](../speaker-guide/web-layout-framework.md).
Both frameworks remain working drafts; the authorized six-pair comparison is complete. Other experiment work is deferred.
`generate.py` projects these sources into `src/deck/deck.ts`, the engine's
content entry point. It converts tables to labelled bullet rows without recalculating any observations. Edit the
Markdown or introduction data and regenerate, not the generated TypeScript. Sources/endpoints/limitations remain in the focused card.

```sh
npm run build
npm test
```

Build performs generation, TypeScript checking, production bundling and writes **`dist/index.html`** with embedded
CSS and JavaScript. Open it directly without a server or network. No workshop illustrations, application routing,
Lovable integration, remote fonts or external report data are needed to present these twenty-one cards. The imported
engine has no audience-PDF layout; use the [flat deck](../index.html) / its existing audience PDF for printing.

Delivery, timing and cuts are Andrei's decision. Earlier timing budgets in the historical
[run of show](../../../docs/research/performance-observability/CONFERENCE_RUN_OF_SHOW.md) do not limit this content.
Raw experiment evidence remains local/ignored in the sibling experiment repository; the deck is not an evidence
archive and does not collect telemetry. Copies of source/engine files are independent: future old-deck changes do
not automatically propagate here.

## Checks

`npm test` runs the copied timer/step-counter tests plus this talk's main-route/appendix and evidence-state contracts.
For Chrome browser checks, reuse an existing Playwright installation (no new dependency required):

```sh
PLAYWRIGHT_PACKAGE_ROOT=../../../../performance-observability node verify.mjs
```

Run the dev server first and build `dist/index.html`. Optional `DECK_URL`, `DECK_PACKED_URL` and `DECK_ARTIFACTS` override
the preview, offline build and output paths. The check waits for card animations, verifies the camera and focused card
fit, twelve main steps/stop, overview/appendix return, notes scroll/timing, help/Home/deep links, 720p fit and offline
packed navigation. Screenshots and verification JSON are written to ignored `artifacts/`.

## Opening photos

The first steps are title → Andrei Tazetdinov → GDG Linz → endpoint model. The three-card opening stays inside
00:00–01:30: title 15 seconds, speaker 45 seconds, community 30 seconds. Earlier card timings remain historical
rehearsal prompts; the two inserted mini-examples require retiming during the agreed 21-slide rewrite.
The speaker portrait and GDG image are byte-identical copies of the old deck's `public/about/me.jpg` and
`public/about/gdg-linz.jpg`; see `ASSET_ORIGIN.json`. They are imported with `?inline` so the standalone HTML embeds
both images and works offline. The GDG image uses contain sizing to preserve the whole mark. LinkedIn/community
QR destinations are copied from the original cards; no network is needed to render them. The original files remain
in place. The flat print fallback has its original eight-card main route and does not include these graph-only intros.


## Measurement images in A / B

The current theory card `slide-02` also embeds the SSR illustration **Visible ≠ interactive**.
It combines an actual imported Chrome Performance trace screenshot and the app after an early click;
[original screenshots and captions](../web-case/figures/README.md) and
[diagnostic conditions](../web-case/LOAD_INSPECTION.md) live inside this presentation folder.
The former text-only boundary card is replaced in the current draft; the complete 21-slide rewrite remains pending.
This is one diagnostic run, not an isolated hydration measurement or a before/after benchmark.

Scenes 03 and 04 show the approved 1920×1080 measurement cards as full-frame images while focused. Their overview
cards keep short titles; full speaker notes and evidence links remain available with N. No main-route steps or time
are added. `measurement-cards.json` maps the two scenes, and `src/assets/measurements/` contains the PNGs and source
hashes. The generator imports both images with `?inline`, so the standalone HTML carries them without a server.

These are presentation summaries of four retained local primary pairs, with original app captures from block 1.
Left is deliberately redundant work enabled; right is disabled. They are not a production bug-fix history or new
measurements. Source analyses/screenshots and output PNG hashes are pinned in `sources.json`. A measures handler
start to the React Profiler callback; B measures navigation to the first App.useLayoutEffect. Neither image is a
hydration/presentation claim. The flat print fallback and original workshop deck are unchanged.

## Mismatch and layout mini-examples

Both are now actual cards in the main route, with inline screenshots and Russian presenter notes:

- `#step=mini-mismatch`, after `slide-02`: real Chrome Console, matching/mismatching DOM observations,
  development screenshot with separate production corroboration. Recovery is established, user-visible cost is not.
- `#step=mini-layout`, after `slide-04`: two actual Chrome Performance timelines and the 120-card diagnostic.
  The full recorded layout population includes later work (121/2), not only the effect bracket (120/1).

HTML compositions and original screenshots are in `../web-case/figures/`; the two embedded PNGs are
`src/assets/measurements/SSR-mismatch.png` and `React-layout.png`. The source JSON files remain linked from
the mini-example notes. These are small diagnostic scenes, not accepted repeated optimization benchmarks.
Adding them updates the current draft, not the full agreed talk or its rehearsal acceptance.

## From profile to observability

`slide-05` now shows an actual OTel SDK → OTLP/HTTP → compatible backend delivery proof and the
workflow for keeping a user action observable after release. It replaces the earlier responsibilities diagram.
The embedded screenshot and verified histogram values are retained-pilot replay, not live RUM or release results.
See [evidence and remaining work](../web-case/OTEL_OBSERVABILITY.md). Vendor internals are not part of the talk.
# React Native subscription investigation

Six cards follow `transition-to-native`, beginning at
`http://127.0.0.1:4349/#step=rn-subscription-scene`.
They retain the lab scope, real Hermes stack screenshot and Release repeat evidence.
Full script: [investigation-02-subscriptions.md](../speaker-guide/investigation-02-subscriptions.md).
The current generated deck has 28 cards, including two appendices; the main route has 26 steps.
Earlier count/route descriptions below describe the previous deck revision.

