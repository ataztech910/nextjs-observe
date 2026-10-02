# nextjs-observe

Monorepo of **[next-observe](packages/next-observe)** (OpenTelemetry for Next.js 16, goes into the app) and
**[nxo](packages/nxo)** (the observer with a trace UI and AI agents that investigate problems on their own, run with
`npx nxo dev`) — the reference implementation for the workshop *AI-Native Observability:
Building Self-Debugging Next.js Applications with OpenTelemetry* (Porto, 10 November 2026).

```
Next.js app + next-observe ── 'use observe', @vercel/otel, browser OTel ──► nxo (OTLP/JSON)
                                                              ├─ trace UI (list, waterfall)
                                                              ├─ anomaly detector ──┐
                                                              └─ chat ◄─────────────┴─ ADK agents (Gemini | Kitana | mock)
                                                                                        tools over the stored telemetry,
                                                                                        evidence cards built from facts
```

| Path | |
|---|---|
| [`packages/next-observe`](packages/next-observe) | instrumentation for the app — see its [README](packages/next-observe/README.md) |
| [`packages/nxo`](packages/nxo) | the observer: collector, UI, detector, agents — see its [README](packages/nxo/README.md) |
| [`docs/WORKSHOP_LOG.md`](docs/WORKSHOP_LOG.md) | every step: what was built, how it was tested, what we learned (Russian) |
| [`docs/WORKSHOP_PLAN.md`](docs/WORKSHOP_PLAN.md) | the 3.5-hour workshop plan |
| [`docs/SPRINTS.md`](docs/SPRINTS.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | the original long-term plan (partly superseded by the log) |
| [`spikes/adk-kitana`](spikes/adk-kitana) | ADK + Kitana experiments behind the workshop's agent cases |
| [`CLAUDE.md`](CLAUDE.md) | working rules for AI-assisted development in this repo |

The workshop app (*Porto Shop*, three planted bugs for the agents to find) lives in a separate repository.
