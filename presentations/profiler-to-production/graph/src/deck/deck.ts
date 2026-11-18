// Generated from CONFERENCE_SLIDES.md + introduction.json. Edit sources, then regenerate.
import type { Deck } from "./types";
import speakerPhoto from "../assets/about/me.jpg?inline";
import communityPhoto from "../assets/about/gdg-linz.jpg?inline";
import interactionCard from "../assets/measurements/A-interaction.png?inline";
import startupCard from "../assets/measurements/B-startup.png?inline";
export const deck: Deck = {
  "meta": {
    "title": "From Profiler to Production",
    "subtitle": "React & React Native · 25 min + 5 min Q&A"
  },
  "nodes": [
    {
      "id": "slide-01",
      "title": "From Profiler to Production",
      "subtitle": "Main talk · 25 minutes",
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
          "Measuring What Actually Matters in React & React Native",
          "Start with the interaction. Name the endpoint. Preserve the evidence."
        ],
        "note": "Timing: 00:00–00:15 elapsed; budget 0:15. State the title, then introduce yourself and GDG Linz. The full three-card opening finishes at 01:30.\n\n“When we say an app is fast, which observation do we mean: load, selected JavaScript work, React completion,\nor pixels presented? I will show controlled cases where these observations answer different questions.\nThese are reproducible local experiments, with explicit limits. They do not prove a universal production result.”\n\nEvidence cue\nScope and six-experiment coverage (CONFERENCE_DEMO_PLAN.md). The original hypothesis remains a question;\nthis draft makes only the selected scoped claims. No numerical performance claim on this title slide."
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
      "id": "slide-02",
      "title": "Name the boundary before reading the number",
      "subtitle": "Main talk · 25 minutes",
      "size": "lg",
      "x": 6360,
      "y": 300,
      "chips": [
        {
          "label": "02",
          "mono": true
        }
      ],
      "badge": {
        "label": "Scoped evidence",
        "tone": "gray"
      },
      "detail": {
        "bullets": [
          "User action → handler → selected JS work → React completion → visible result",
          "Selected work — Boundary: Explicit synchronous callback body",
          "React completion — Boundary: Handler start → Profiler callback",
          "Readiness — Boundary: Navigation start → declared app marker",
          "Presentation — Boundary: Requires a browser/native presentation source",
          "React completion and readiness leave presentation unmeasured in these app markers."
        ],
        "note": "Timing: 01:30–04:30 elapsed; budget 3:00. Finish endpoint definitions by 04:30; the arrow is conceptual, not a measured critical path.\n\n“This arrow is a conceptual sequence, not a measured critical path. Intervals can overlap, work can repeat,\nand asynchronous or concurrent operations need explicit context. Our Profiler endpoint records an app-defined\ncompletion observation; it does not reveal when pixels became visible. We retain missing observations as missing.\nWe also keep wall duration, sampled CPU evidence and independently acquired process CPU separate.”\n\nEvidence cue\nInteraction/timeline model (PERFORMANCE_TIMELINE.md), selected hook strategy (REACT_HOOK_INSTRUMENTATION.md),\nA endpoint (EXPERIMENT_A_GATE.md), B endpoints (EXPERIMENT_B_GATE.md)."
      }
    },
    {
      "id": "slide-03",
      "title": "Same score. Different response.",
      "subtitle": "A · Handler start → React Profiler callback · Four matched local pairs",
      "size": "lg",
      "x": 240,
      "y": 1900,
      "chips": [
        {
          "label": "03",
          "mono": true
        }
      ],
      "badge": {
        "label": "Scoped evidence",
        "tone": "gray"
      },
      "detail": {
        "bullets": [
          "Paired median gaps: 214.2 · 200.8 · 213.3 · 213.6 ms. Lighthouse measures navigation; measure the later interaction separately."
        ],
        "note": "Timing: 04:30–08:30 elapsed; budget 4:00. Use at most 60 seconds for the saved report; skip diagnostics if late. Finish A at 08:30.\n\n“Here the navigation score stays at 100 in all eight load reports. Then the user performs the nominated\ninteraction. Every matched block shows a larger handler-to-Profiler median with the deferred expensive work.\nLighthouse is measuring its declared load protocol; our later interaction is a different endpoint.\nThe four numbers are block-level differences. The individual clicks are not independent run replications.”\n\n“Lifecycle INP is recorded separately on the three-click lab pages. It is not a renamed handler duration or a\nfield Core Web Vital. The profiled source diagnostics are separate runs, excluded from these primary timings.”\n\nEvidence cue\nA protocol, full values and limitations (EXPERIMENT_A_GATE.md).\nSelect ?report=load-a-1794560947170-6c40 on its session viewer. Show both variants and all primary blocks;\nuse the separate lifecycle/source attachment if asked. If the viewer is unavailable, use the retained original\nreport screenshot or analysis with this session/endpoint visible; do not collect a new timing during the talk.",
        "image": interactionCard
      }
    },
    {
      "id": "slide-04",
      "title": "Same JavaScript. Different startup.",
      "subtitle": "B · Navigation → first App.useLayoutEffect · Same downloaded code",
      "size": "lg",
      "x": 2280,
      "y": 1900,
      "chips": [
        {
          "label": "04",
          "mono": true
        }
      ],
      "badge": {
        "label": "Scoped evidence",
        "tone": "gray"
      },
      "detail": {
        "bullets": [
          "Equal download size does not mean equal executed work or readiness. Controlled configurations; not a production bug-fix history."
        ],
        "note": "Timing: 08:30–12:30 elapsed; budget 4:00. Use at most 60 seconds for saved byte evidence; finish B at 12:30.\n\n“The same compiled code is configured to do different amounts of redundant startup work, with the same result.\nThe preserved response bodies and browser/cache receipts establish byte comparability. This is a controlled\nsame-artifact example; it does not compare the parse cost of two different equal-size bundles.”\n\n“The selected compute interval excludes imports, SDK and capture setup. Navigation-to-first-layout-effect\nincludes earlier loading and setup. Neither number is whole-bundle CPU or paint. Gzip was actually served;\nBrotli sizes are saved artifacts. Browser transferSize is not exact socket traffic. Diagnostic source profiles\nare excluded from the four primary timing pairs.”\n\nEvidence cue\nB exact protocol and byte joins (EXPERIMENT_B_GATE.md).\nSelect ?report=bundle-b-1794566743221-443a; show byte evidence beside the distinct timing endpoints.\nDiagnostic readiness remains unavailable rather than entering the primary comparison.",
        "image": startupCard
      }
    },
    {
      "id": "slide-05",
      "title": "Instrumentation and analysis have different jobs",
      "subtitle": "Main talk · 25 minutes",
      "size": "lg",
      "x": 4320,
      "y": 1900,
      "chips": [
        {
          "label": "05",
          "mono": true
        }
      ],
      "badge": {
        "label": "Scoped evidence",
        "tone": "gray"
      },
      "detail": {
        "bullets": [
          "Observe / app → OpenTelemetry SDK → OTLP → collector / archive → Observer",
          "External Playwright / Maestro harness → preserved observations and analysis → typed report → Observer",
          "Observe and app adapters — Responsibility: Selected instrumentation and source context",
          "External harness — Responsibility: Protocol, independent sources, statistics and artifacts",
          "Backend collector/archive — Responsibility: OTLP ingestion, storage, finalization and replay",
          "Observer frontend — Responsibility: Display reports, telemetry and explicit unavailable states"
        ],
        "note": "Timing: 12:30–15:30 elapsed; budget 3:00. Use the four responsibility rows. Omit the optional C walkthrough if late. Finish at 15:30.\n\n“OpenTelemetry is the interoperability boundary. The backend collector lives in the next-observer package,\nwhile its ingestion and storage responsibilities are separate from the frontend. We do not move app\ninstrumentation or experiment statistics into the visualization.”\n\n“Manual selected hook work carries a source site and explicit interaction context. This is not complete automatic\nhook discovery. Our supporting C Playwright report is a single baseline functional smoke with three actions;\nit verifies association and the pipeline, not an optimization effect or statistical performance acceptance.”\n\nEvidence cue\nActual implementation files and responsibilities (F_EVIDENCE_MATRIX.md#responsibilities-and-current-implementation),\nObserve manual strategy (REACT_HOOK_INSTRUMENTATION.md), scenario reader (SCENARIO_REPORTS.md).\nOptional C report: web-scenario-1794566774159-a535ac. The two arrows describe data flow, not shared clock alignment."
      }
    },
    {
      "id": "slide-06",
      "title": "F delivery: a completed check can contain incomplete telemetry",
      "subtitle": "Source: pipeline-1794641370737-5d72 Endpoint: produced spans → SDK queue → exporter → receiver. Boundary: controlled faults; no production loss-rate claim.",
      "size": "lg",
      "x": 6360,
      "y": 1900,
      "chips": [
        {
          "label": "06",
          "mono": true
        }
      ],
      "badge": {
        "label": "Controlled delivery faults",
        "tone": "amber"
      },
      "detail": {
        "bullets": [
          "Healthy export — Delivery state: passed",
          "Deliberate queue overflow: 20 dropped spans — Delivery state: incomplete",
          "HTTP400 rejection — Delivery state: failed"
        ],
        "note": "Timing: 15:30–19:30 elapsed; budget 4:00. Use at most 60 seconds for the trace report; reserve metric retry details for questions. Finish at 19:30.\n\n“The fault-validation check succeeds when it accurately preserves the fault. It cannot promote delivery to passed.\nThe overflow archive remains unfinalized and the rejected export remains failed. A received-only archive tells us\nwhat arrived; producer IDs, SDK counts and exporter evidence tell us what is missing.”\n\n“Metric retry, rejection and held-callback cases add another distinction: a reader flush can resolve while export\nerrors still exist. Keep callbacks, HTTP attempts and received records separate. Cumulative histogram checkpoints\nare separate snapshots; adding them counts earlier observations again.”\n\nEvidence cue\nTrace gate (F_PIPELINE_GATE.md), optional metric gate (F_METRIC_DELIVERY_GATE.md).\nOn the source shelf select ?report=pipeline-1794641370737-5d72 and scroll to overflow and HTTP400, not just healthy.\nThe report also contains a disabled-control row; the three rows above are a selected case view, not its full inventory.\nOptional metric report: metric-1794646414485-258d. Retain failed/incomplete labels in any screenshot crop."
      }
    },
    {
      "id": "slide-07",
      "title": "F cost: keep bytes, readiness and CPU separate",
      "subtitle": "Source: stripped-1794680848671-8f54 Boundary: two build artifacts, six local alternating run pairs; no accepted overhead budget.",
      "size": "lg",
      "x": 240,
      "y": 3500,
      "chips": [
        {
          "label": "07",
          "mono": true
        }
      ],
      "badge": {
        "label": "No accepted overhead budget",
        "tone": "amber"
      },
      "detail": {
        "bullets": [
          "Stripped — Bytes: 1871 B",
          "Observe installed, runtime disabled — Bytes: 8275 B",
          "Installed-minus-stripped navigation → adapter-ready:",
          "+21.433 ms [1.450, 44.650], exploratory 95% paired interval.",
          "Work-CPU interval spans zero."
        ],
        "note": "Timing: 19:30–23:00 elapsed; budget 3:30. Keep byte/readiness/CPU boundaries; defer statistical-method details. Start the closing slide at 23:00.\n\n“Both groups are disabled. One build removes Observe and OTel; the other retains the installed adapter and lazy SDK\ngraph. Source maps and the actual loaded response bodies verify the difference. These are loaded gzip body bytes,\nnot emitted totals, installation footprint or total wire traffic.”\n\n“Adapter-ready happens before variable metadata/archive setup. The wall difference combines loading, evaluation\nand setup effects of these two builds. The original interval is exploratory, using paired-run bootstrap assumptions.\nSix run pairs are not six independent builds. The work-CPU interval includes zero: we cannot conclude equivalence,\na speedup or acceptable overhead. Startup wall does not measure startup CPU. All contrasts remain in the attachment.”\n\nEvidence cue\nStripped protocol and all original contrasts (F_STRIPPED_STUDY.md).\nOn the paced/monitor/build shelf select ?report=stripped-1794680848671-8f54.\nKeep loaded/emitted and work/finish windows separate. Do not subtract results from another F study."
      }
    },
    {
      "id": "slide-08",
      "title": "Make the performance statement inspectable",
      "subtitle": "Main talk · 25 minutes",
      "size": "lg",
      "x": 2280,
      "y": 3500,
      "chips": [
        {
          "label": "08",
          "mono": true
        }
      ],
      "badge": {
        "label": "Scoped evidence",
        "tone": "gray"
      },
      "detail": {
        "bullets": [
          "For every result, carry:",
          "Endpoint and measurement source.",
          "Workload, build and environment.",
          "Independent run count and uncertainty.",
          "Delivery, missing data and source artifacts.",
          "Next step: choose the target claim, then measure its missing endpoint."
        ],
        "note": "Timing: 23:00–25:00 elapsed; budget 2:00. Close at 25:00 and leave 5 minutes for Q&A. Stay here; do not automatically advance to A1.\n\n“The examples show why the metric name alone is insufficient. We can already show these bounded comparisons in\nObserver. A product overhead guarantee would need a workload, target devices/builds, validated cost sources,\na budget and a declared decision rule. Those are still open. We have ten different scoped F protocols, not a\nsingle pooled benchmark. Their row counts are inventory, not acceptance percentages.”\n\n“For native performance, the next missing observation is independently supported presentation on a physical\nRelease target. We should state that gap explicitly rather than infer frame smoothness from JS or callback data.”\n\nEvidence cue\nFull coverage, boundaries and closure order (F_EVIDENCE_MATRIX.md),\npinned index (F_EVIDENCE_INDEX.json), demo fallback/rehearsal (CONFERENCE_DEMO_PLAN.md).\nClose here for the short version. The native and runner slides below are optional appendices, within the five-minute Q&A allocation. No claim that all A–F or production performance acceptance is complete."
      }
    },
    {
      "id": "slide-A1",
      "title": "React Native: callback cadence is one observable",
      "subtitle": "Source: ios-cadence-1794441662289; diagnostic corroboration ios-system-1794455821579. Boundary: Simulator functional evidence; no physical smoothness or dropped-frame conclusion.",
      "size": "lg",
      "x": 4320,
      "y": 3500,
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
      "x": 6360,
      "y": 3500,
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
      "to": "slide-02"
    },
    {
      "from": "slide-02",
      "to": "slide-03"
    },
    {
      "from": "slide-03",
      "to": "slide-04"
    },
    {
      "from": "slide-04",
      "to": "slide-05"
    },
    {
      "from": "slide-05",
      "to": "slide-06"
    },
    {
      "from": "slide-06",
      "to": "slide-07"
    },
    {
      "from": "slide-07",
      "to": "slide-08"
    },
    {
      "from": "slide-08",
      "to": "slide-A1",
      "kind": "dashed",
      "label": "Q&A"
    },
    {
      "from": "slide-08",
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
      "part": "Main talk · 25 minutes",
      "caption": "Start with the interaction. Name the endpoint."
    },
    {
      "id": "about-me",
      "focus": [
        "about-me"
      ],
      "part": "Opening · within 1:30",
      "caption": "Who is talking"
    },
    {
      "id": "gdg-linz",
      "focus": [
        "gdg-linz"
      ],
      "part": "Opening · within 1:30",
      "caption": "GDG Linz"
    },
    {
      "id": "slide-02",
      "focus": [
        "slide-02"
      ],
      "part": "Main talk · 25 minutes",
      "caption": "Sources, endpoints and limitations travel with the result."
    },
    {
      "id": "slide-03",
      "focus": [
        "slide-03"
      ],
      "part": "Main talk · 25 minutes",
      "caption": "Sources, endpoints and limitations travel with the result."
    },
    {
      "id": "slide-04",
      "focus": [
        "slide-04"
      ],
      "part": "Main talk · 25 minutes",
      "caption": "Sources, endpoints and limitations travel with the result."
    },
    {
      "id": "slide-05",
      "focus": [
        "slide-05"
      ],
      "part": "Main talk · 25 minutes",
      "caption": "Sources, endpoints and limitations travel with the result."
    },
    {
      "id": "slide-06",
      "focus": [
        "slide-06"
      ],
      "part": "Main talk · 25 minutes",
      "caption": "Sources, endpoints and limitations travel with the result."
    },
    {
      "id": "slide-07",
      "focus": [
        "slide-07"
      ],
      "part": "Main talk · 25 minutes",
      "caption": "Sources, endpoints and limitations travel with the result."
    },
    {
      "id": "slide-08",
      "focus": [
        "slide-08"
      ],
      "part": "Main talk · 25 minutes",
      "caption": "25:00 → Q&A. Overview opens the optional appendices.",
      "next": null
    },
    {
      "id": "slide-A1",
      "focus": [
        "slide-A1"
      ],
      "part": "Q&A · within 5 minutes",
      "caption": "Sources, endpoints and limitations travel with the result.",
      "returnToStep": "slide-08"
    },
    {
      "id": "slide-A2",
      "focus": [
        "slide-A2"
      ],
      "part": "Q&A · within 5 minutes",
      "caption": "Sources, endpoints and limitations travel with the result.",
      "returnToStep": "slide-08"
    }
  ]
};
