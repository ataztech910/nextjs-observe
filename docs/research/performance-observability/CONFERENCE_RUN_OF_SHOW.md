# Run of show — 30 minutes total

The speaker confirmed a 30-minute total slot on 15 November 2026. Working allocation: **25 minutes presentation,
5 minutes Q&A**, including slide/viewer transitions. The Q&A split is our proposed allocation within that total,
not an additional organizer instruction. This supersedes the earlier approximate 12-minute evidence-only estimate.
The durations below are rehearsal targets, not measured speaking times or new experiment measurements.

## Main sequence

| Slide | Elapsed window | Budget | What to finish in this window |
| --- | --- | --- | --- |
| 01 — Title | 00:00–01:30 | 1:30 | State the question and local-experiment scope. Move on without an extra biography or product tour. |
| 02 — Endpoint model | 01:30–04:30 | 3:00 | Distinguish selected work, Profiler completion, readiness and presentation. Establish that overlapping intervals are not additive. |
| 03 — A | 04:30–08:30 | 4:00 | Show all eight load scores and four paired block differences. Allow at most 60 seconds for the saved report; keep lifecycle INP separate. |
| 04 — B | 08:30–12:30 | 4:00 | Show identical bytes and the two timing rows. Allow at most 60 seconds for saved byte evidence; state same artifact/different configured work. |
| 05 — Responsibilities | 12:30–15:30 | 3:00 | Explain Observe/app, external harness, collector/archive and Observer display. Use the slide itself; the optional C walkthrough is not required. |
| 06 — F delivery | 15:30–19:30 | 4:00 | Show incomplete overflow and failed HTTP400. Allow at most 60 seconds for the saved trace report. Keep the metric retry/flush example for questions. |
| 07 — F cost | 19:30–23:00 | 3:30 | Distinguish loaded gzip bytes, readiness wall and work CPU. State the local/two-build/exploratory boundary; do not explain the full bootstrap algorithm here. |
| 08 — Takeaway | 23:00–25:00 | 2:00 | Give the four evidence requirements and state the physical native/product-overhead gaps. Invite questions at 25:00. |
| Q&A | 25:00–30:00 | 5:00 | Stay on 08; open A1/A2 only for a relevant question. End at 30:00. |

The main-slide budgets sum to 25:00. The four evidence scenes total 15:30; opening/model/architecture/closing total
9:30. Appendices A1/A2 have no separate presentation budget. The deck's Next button still goes from 08 to A1:
stop advancing at 08 and use **O** to select an appendix when answering a question. Printing pages 1–8 produces
the core audience deck; printing all ten retains question-support slides.

## Timing checkpoints and recovery

At **08:30**, A is finished. At **15:30**, the responsibilities slide is finished. At **23:00**, start the closing slide.
At **25:00**, switch to Q&A. All report windows and switching time are inside the listed budgets; do not add them
on top. Keep notes closed on a screen shared with the audience. Notes are local presenter prompts, not a private
second display. Use a separate visible clock for rehearsal; this step adds no automatic countdown or slide advance.

If running late, reduce optional explanation and screen switching while retaining sources, endpoints and caveats:

- Finish A/B with the existing slide values; skip viewer visits and diagnostic attachments.
- Keep 05 to the four responsibility rows; omit the C functional walkthrough.
- Show the three trace cases on 06; omit metric retry details and additional report navigation.
- On 07 keep the byte table, readiness interval and CPU caveat; defer statistical-method details to Q&A.
- If the clock is already at 23:00, go directly to 08, state what was omitted and close by 25:00. Do not present an omitted experiment as demonstrated.

If a viewer fails, use the original retained slide/result according to the [demo fallback](CONFERENCE_DEMO_PLAN.md#rehearsal-acceptance-and-fallback).
Do not debug the viewer, collect fresh timing or fabricate substitute values on stage. Preserve enough time to state
the limitations; speed does not justify relabelling Profiler completion as paint or cadence as native presentation.

## Transitions

| After slide | Suggested spoken bridge |
| --- | --- |
| 01 | “First, let us agree which boundary the number actually measures.” |
| 02 | “Now compare a load observation with deliberately later work.” |
| 03 | “A second shortcut is to treat the number of bytes as the amount of execution.” |
| 04 | “To inspect that difference, we need observations, analysis and a reader with separate responsibilities.” |
| 05 | “Before trusting the result, check whether the telemetry arrived.” |
| 06 | “Then ask what collecting it cost, using a declared comparison.” |
| 07 | “These results become useful when the endpoint and its limits travel with the number.” |
| 08 | “Which endpoint would you need for the performance claim in your application?” |

## Q&A prompts

| Likely question | Bounded answer and supporting slide |
| --- | --- |
| Does a Lighthouse score of 100 mean the tool is wrong? | No. The expensive work was deferred beyond the load protocol; the later interaction is another endpoint. Use 03. |
| Have you proved a low overhead percentage? | No accepted budget is declared. Keep the two-build readiness result and zero-spanning work-CPU interval distinct. Use 07 and the [F matrix](F_EVIDENCE_MATRIX.md). |
| Can you say the native animation was smooth? | No. The retained Simulator evidence is callback cadence/system recording; presentation/hitches remain unavailable. Open A1 and preserve the physical-device gap. |
| Why can a finalized archive have a failed scenario? | The runner's deliberately wrong completion assertion failed independently of telemetry archival. Open A2. |
| Do all hooks and frameworks work automatically? | The demonstrated manual selected work has explicit source/context. Next-specific bootstrap is separate; no universal automatic React/RN instrumentor is claimed. Use 05. |

A short Q&A does not require opening both appendices. If no questions arrive, use the time for one audience prompt
or a bounded clarification, then close; do not invent a native-performance demonstration to fill the slot.

## Rehearsal pass

Rehearse the eight-slide route once with a real clock, including at most the three nominated viewer visits. Record
actual finish times against the checkpoints above; the first actual rehearsal is still pending. Rehearse the slide-only
fallback once if report switching threatens the slot. Keep original frozen sessions and source/build/endpoints visible.
The [visual deck](../../../presentations/profiler-to-production/index.html) embeds these timing cues in its notes;
the [slide source](CONFERENCE_SLIDES.md) remains the source of that content. No native/benchmark acceptance changes.
