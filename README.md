# nextjs-observe

Monorepo of two packages, one letter apart: **[next-observe](packages/next-observe)** — the **APM agent**, a library inside
the Next.js 16 app that collects OpenTelemetry traces and sends them — and **[next-observer](packages/next-observer)** — the
**observer**, a server with a UI and **AI agents** that receives the traces, shows them and investigates problems on its
own (run with `npx next-observer dev`) — the reference implementation for the workshop *AI-Native Observability:
Building Self-Debugging Next.js Applications with OpenTelemetry* (Porto, 10 November 2026).

```
Next.js app + next-observe ── 'use observe', @vercel/otel, browser OTel ──► next-observer (OTLP/JSON)
                                                              ├─ trace UI (list, waterfall)
                                                              ├─ anomaly detector ──┐
                                                              └─ chat ◄─────────────┴─ AI agents: ADK (Gemini | Kitana | mock)
                                                                                        tools over the stored telemetry,
                                                                                        evidence cards built from facts
```

| Path | |
|---|---|
| [`packages/next-observe`](packages/next-observe) | instrumentation for the app — see its [README](packages/next-observe/README.md) |
| [`packages/next-observer`](packages/next-observer) | the observer: collector, UI, detector, agents — see its [README](packages/next-observer/README.md) |
| [`docs/WORKSHOP_LOG.md`](docs/WORKSHOP_LOG.md) | every step: what was built, how it was tested, what we learned (Russian) |
| [`docs/WORKSHOP_PLAN.md`](docs/WORKSHOP_PLAN.md) | the 3.5-hour workshop plan |
| [`docs/PROD_DEMO.md`](docs/PROD_DEMO.md) | block 5: observer on a server + the shop on Vercel (instructor runbook, Russian) |
| [`docs/SPRINTS.md`](docs/SPRINTS.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | the original long-term plan (partly superseded by the log) |
| [`spikes/adk-kitana`](spikes/adk-kitana) | ADK + Kitana experiments behind the workshop's agent cases |
| [`CLAUDE.md`](CLAUDE.md) | working rules for AI-assisted development in this repo |

The workshop app (*Porto Shop*, three planted bugs for the agents to find) lives in a separate repository.
