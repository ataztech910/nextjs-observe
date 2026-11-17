# From Profiler to Production — presentation

## Preferred version — original graph engine

The new talk now uses an independent copy of the engine from `workshop-slides`: gliding camera, graph cards/edges,
overview, notes and the original keyboard/gamepad controls. The old presentation stays untouched in its own folder.

```sh
cd presentations/profiler-to-production/graph
npm ci
npm run dev
```

From the monorepo root, these commands open **http://127.0.0.1:4349/**. For an offline file, run `npm run build`
and open `graph/dist/index.html`. [Engine details, controls, provenance and checks](graph/README.md).
The graph adds speaker/GDG photo cards after the title (12 cards total, 10 main + 2 appendices). The opening still fits 1:30.
The graph route stops at 08; its Q&A cards return there. It uses `#step=slide-03` links.

## Flat print fallback

The earlier flat HTML below is retained for printing/audience PDF and as a fallback. Its controls/hash format are
specific to that version. It is separate from the preferred graph engine and from the original workshop deck.

Slot: **30 minutes total**. The [run of show](../../docs/research/performance-observability/CONFERENCE_RUN_OF_SHOW.md)
allocates 25 minutes to slides 01–08 and 5 minutes to questions; A1/A2 support Q&A. Timing cues appear only in notes.
Actual spoken timing still needs rehearsal. Stop advancing at 08; use the overview to open a relevant appendix.

A separate 10-slide visual deck for **Measuring What Actually Matters in React & React Native**:
eight core slides and two optional appendices. The existing sibling `workshop-slides` presentation stays in place;
this folder does not read, import or write it.

Open [index.html](index.html) directly in a modern browser. It embeds all CSS, JavaScript, audience copy and notes;
there are no CDN fonts, remote assets, network requests, npm dependencies or installation steps. A local HTTP preview
also works. From the monorepo root:

```sh
python3 -m http.server 4348 --bind 127.0.0.1
```

Open `http://127.0.0.1:4348/presentations/profiler-to-production/`.
Use a free port; this is separate from the older workshop deck and Observer services.

| Control | Action |
| --- | --- |
| ← / →, Page Up / Down, Space | Previous/next (Space advances when the page body has focus) |
| Home / End | First/last slide |
| N / Notes | Toggle local speaker notes and evidence cues |
| O / Slides | Slide overview; Escape closes the dialog |
| Escape | Hide notes when the overview is closed |
| F / Fullscreen | Enter/exit fullscreen where supported |
| Print / PDF | Browser print: all 10 slides, no notes or controls |

Direct links use `#slide-03`, `#slide-07`, `#slide-A1`, etc. Browser back/forward follows slide history.
Notes appear in the same browser window and are visible to anyone watching that screen. This is not a separate
presenter monitor or a private notes channel. Close them before screen sharing audience slides. They remain embedded
in the HTML source; the audience PDF excludes them.

For PDF, choose **Save as PDF**, disable browser headers/footers and retain background graphics. The deck defines
16:9 landscape pages. Browser print includes both appendices; select pages 1–8 in the print dialog for the core deck.
The verified PDF export is a generated artifact, not a source file (`*.pdf` is ignored here).

## Editing and building

The reviewed source is [CONFERENCE_SLIDES.md](../../docs/research/performance-observability/CONFERENCE_SLIDES.md).
Edit audience copy and speaker notes there, then run from the monorepo root:

```sh
python3 presentations/profiler-to-production/build.py
python3 -m unittest discover -s presentations/profiler-to-production -p 'test_*.py'
```

The standard-library builder embeds `style.css`, `deck.js` and the slide content into `index.html`, which is committed
so the presentation opens immediately after checkout. Its deliberately small Markdown renderer supports the reviewed
paragraph/list/table/emphasis/code/local-evidence-link subset; it is not a general Markdown engine. Keep slide IDs
01–08/A1/A2 and the on-screen/notes/evidence sections. Review layout after changing copy length. Styling is independent
of the old deck. The [demo plan](../../docs/research/performance-observability/CONFERENCE_DEMO_PLAN.md) owns the evidence
viewer startup, declared measurement boundaries and fallback procedure.

Relative evidence links need the surrounding monorepo checkout. Copying just `index.html` preserves slides and notes,
but does not copy the linked Markdown, raw reports or screenshots. Actual experiment evidence remains in the ignored
local sibling experiment repository with no remote; this deck does not publish it. Performance observations and
unsupported native/overhead claims retain the original limits. No measurements are collected by the presentation.

## Browser verification

With the preview server above running and Chrome installed, reuse an existing Playwright installation (the sibling
experiment repository already provides one); no production dependency is added:

```sh
PLAYWRIGHT_PACKAGE_ROOT=../performance-observability \
node presentations/profiler-to-production/verify.mjs
```

Optional `DECK_URL` overrides the preview URL and `DECK_ARTIFACTS` overrides the output directory. The check visits all
ten slides, measures overlap/overflow, checks navigation/history/notes/overview/bounds, a 720p window and mobile width,
then verifies print isolation and offline file navigation. It saves screenshots, a 10-slide PDF and `verification.json`
in ignored `artifacts/`. These are presentation checks, not new performance measurements.
