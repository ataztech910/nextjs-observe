# Performance talk on the workshop graph engine

This is an independent copy of the engine from the sibling `workshop-slides` presentation, at commit
`2b4edfc073545d8d5aaa879c10dd392f874b748e`. The original deck stays in its original folder unchanged.
`ENGINE_ORIGIN.json` records all 24 copied files and their original hashes. The copied PresenterNotes component alone
adds a scroll limit/paragraph preservation for the longer timing notes; the other 23 engine files are byte-identical.
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

Appendices A1/A2 are accessible from overview; Next returns them to 08. The main counter remains 8 steps, excluding
appendices. Deep links use **`#step=slide-03`**, unlike the flat fallback's hash format. The engine maintains its own
navigation trail; it uses replaceState for its URL rather than creating browser-history entries for each step.
Notes overlay the same window, not a private presenter screen. Close them before projecting audience content.

## Content and standalone build

The [reviewed Markdown](../../../docs/research/performance-observability/CONFERENCE_SLIDES.md) supplies audience values,
source/endpoint/boundary text and full notes. `generate.py` projects that content into `src/deck/deck.ts`, the engine's
content entry point. It converts tables to labelled bullet rows without recalculating any observations. Edit the
Markdown and regenerate, not the generated TypeScript. Sources/endpoints/limitations remain in the focused card.

```sh
npm run build
npm test
```

Build performs generation, TypeScript checking, production bundling and writes **`dist/index.html`** with embedded
CSS and JavaScript. Open it directly without a server or network. No workshop illustrations, application routing,
Lovable integration, remote fonts or external report data are needed to present these ten cards. The imported
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
fit, eight main steps/stop, overview/appendix return, notes scroll/timing, help/Home/deep links, 720p fit and offline
packed navigation. Screenshots and verification JSON are written to ignored `artifacts/`.
