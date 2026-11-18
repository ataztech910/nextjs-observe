# Performance talk on the workshop graph engine

> **Content status — 17 November:** The viewer and introduction photos are available; the talk content remains a partial draft. The [fixed title, abstract and required experiments](../../../docs/research/performance-observability/CONFERENCE_BRIEF.md) govern completion. The existing evidence-only route does not yet fulfill that brief.

This is an independent copy of the engine from the sibling `workshop-slides` presentation, at commit
`2b4edfc073545d8d5aaa879c10dd392f874b748e`. The original deck stays in its original folder unchanged.
`ENGINE_ORIGIN.json` records all 24 copied files and their original hashes. PresenterNotes adds a scroll limit/paragraph preservation for the longer timing notes; NodeCard displays a focused
measurement image as a full frame. The other 22 copied engine files are byte-identical.
The React app entry, Vite setup, content generator and offline packer are new integration code.

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
is not claimed by this migration. There is no timer attached to individual talk cards. The top bar shows elapsed
page time, not an automatic 25-minute hard stop.

| Key | Action |
| --- | --- |
| → / Space / Page Down | Next; main route stops on 08 |
| ← / Page Up | Back through navigation history |
| O / Escape | Overview; click a card to focus it |
| N | Notes with elapsed timing targets |
| F | Fullscreen |
| Home | First step |
| ? | Original engine help |

Appendices A1/A2 are accessible from overview; Next returns them to 08. The main counter now has 10 steps (eight talk cards plus two opening cards), excluding
appendices. Deep links use **`#step=slide-03`**, unlike the flat fallback's hash format. The engine maintains its own
navigation trail; it uses replaceState for its URL rather than creating browser-history entries for each step.
Notes overlay the same window, not a private presenter screen. Close them before projecting audience content.

## Content and standalone build

The [reviewed Markdown](../../../docs/research/performance-observability/CONFERENCE_SLIDES.md) supplies audience values,
source/endpoint/boundary text and full notes. `introduction.json` supplies the copied speaker/GDG opening cards.
`generate.py` projects both sources into `src/deck/deck.ts`, the engine's
content entry point. It converts tables to labelled bullet rows without recalculating any observations. Edit the
Markdown or introduction data and regenerate, not the generated TypeScript. Sources/endpoints/limitations remain in the focused card.

```sh
npm run build
npm test
```

Build performs generation, TypeScript checking, production bundling and writes **`dist/index.html`** with embedded
CSS and JavaScript. Open it directly without a server or network. No workshop illustrations, application routing,
Lovable integration, remote fonts or external report data are needed to present these twelve cards. The imported
engine has no audience-PDF layout; use the [flat deck](../index.html) / its existing audience PDF for printing.

The slot is 30 minutes total: 25 presentation + 5 Q&A. These are rehearsal targets; no actual speaking rehearsal
has been measured. See the [run of show](../../../docs/research/performance-observability/CONFERENCE_RUN_OF_SHOW.md).
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
fit, ten main steps/stop, overview/appendix return, notes scroll/timing, help/Home/deep links, 720p fit and offline
packed navigation. Screenshots and verification JSON are written to ignored `artifacts/`.

## Opening photos

The first steps are title → Andrei Tazetdinov → GDG Linz → endpoint model. The three-card opening stays inside
00:00–01:30: title 15 seconds, speaker 45 seconds, community 30 seconds. Other slide timing is unchanged.
The speaker portrait and GDG image are byte-identical copies of the old deck's `public/about/me.jpg` and
`public/about/gdg-linz.jpg`; see `ASSET_ORIGIN.json`. They are imported with `?inline` so the standalone HTML embeds
both images and works offline. The GDG image uses contain sizing to preserve the whole mark. LinkedIn/community
QR destinations are copied from the original cards; no network is needed to render them. The original files remain
in place. The flat print fallback has its original eight-card main route and does not include these graph-only intros.


## Measurement images in A / B

Scenes 03 and 04 show the approved 1920×1080 measurement cards as full-frame images while focused. Their overview
cards keep short titles; full speaker notes and evidence links remain available with N. No main-route steps or time
are added. `measurement-cards.json` maps the two scenes, and `src/assets/measurements/` contains the PNGs and source
hashes. The generator imports both images with `?inline`, so the standalone HTML carries them without a server.

These are presentation summaries of four retained local primary pairs, with original app captures from block 1.
Left is deliberately redundant work enabled; right is disabled. They are not a production bug-fix history or new
measurements. Source analyses/screenshots and output PNG hashes are pinned in `sources.json`. A measures handler
start to the React Profiler callback; B measures navigation to the first App.useLayoutEffect. Neither image is a
hydration/presentation claim. The flat print fallback and original workshop deck are unchanged.
