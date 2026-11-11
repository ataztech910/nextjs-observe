# React and hook instrumentation

## Existing Observe capabilities

The directive transform wraps selected whole function bodies, classifies uppercase names as components, retains relative file/name attributes and sets displayName ([plugin.ts:64–135](../../../packages/next-observe/src/transform/plugin.ts#L64)). Browser component invocations produce aggregated count/total/max attributes every five seconds, with no commit/interaction association ([runtime.ts:9–35](../../../packages/next-observe/src/runtime.ts#L9)). A custom hook marked as a function can produce a whole-call span, but there is no hook-callsite visitor, hook phase model or built-in hook wrapper in this plugin. The Babel library transform preserves a source map ([transform/index.ts:28](../../../packages/next-observe/src/transform/index.ts#L28)); this is not source-map upload/resolution/navigation in Observer.

Reuse the ordinary-function timing path and OTel API integration. Do not relabel the component aggregate as Profiler data. Render-time telemetry is an observable side effect and needs opt-in diagnostic treatment, especially when optimizing compilers are enabled.

## React measurement semantics

The public [Profiler API](https://react.dev/reference/react/Profiler) reports subtree render duration (`actualDuration`), estimate (`baseDuration`), render start and shared commit timestamp, for a committed update. Production requires a profiling build. Its `commitTime` is **not commit duration**. A Profiler observation must be represented as an event with measured render-work duration, not an occupied span covering `startTime..startTime+actualDuration`, because React can yield.

A function-body timer measures a synchronous invocation, not the whole subtree, renderer commit, layout, paint or native presentation. Attempts may be interrupted, restarted, abandoned or repeated; a counter of calls is not a count of visible updates. Batching can combine updates from different interactions. Profiler sees committed updates and cannot be used as a complete aborted-work ledger. Development Strict Mode repeats render/effect work; keep dev/profiling/release results separate ([StrictMode](https://react.dev/reference/react/StrictMode)).

[React Performance tracks](https://react.dev/reference/dev-tools/react-performance-tracks) already show scheduler, component/render and effect phases with other browser work. Availability differs between development/profiling builds. This weakens any claim that “existing React tools cannot show effects or interaction-related render work.” It does not provide a stable OTel hook invocation exporter.

## What each hook can meaningfully measure

All callback timing below is selected synchronous wall-clock work. Clock reads, try/finally, metadata lookup and optional span export add overhead; no fixed cost has been measured. State/dependency values must not be exported.

| Hook | Measure / phase | Cannot reliably infer | Attribution and overhead | OTel representation |
|---|---|---|---|---|
| [useMemo](https://react.dev/reference/react/useMemo) | Calculation body duration and invocation count, render phase | Hook registration time is not calculation cost; not every invocation commits; automatic compiler caches are not equivalent useMemo calls | Stable component/site/build id, render-attempt context; two timestamps + timer/aggregation per executed calculation | Compute span in diagnostic mode, histogram/count otherwise |
| [useEffect](https://react.dev/reference/react/useEffect) | Setup body and returned cleanup separately, passive effect phase | Setup return is not completion of async work; cleanup may belong to an earlier interaction; passive does not always mean after paint | Effect-instance generation, owner component and originating update where explicit; wrapper allocation and cleanup wrapper affect overhead | Separate setup/cleanup spans, async operation spans with explicit context |
| [useLayoutEffect](https://react.dev/reference/react/useLayoutEffect) | Setup/cleanup synchronous body, layout effect phase | Browser pre-paint behavior does not establish RN native presentation; can't derive entire commit cost | Same as effect; avoid heavy OTel work on paint-sensitive path | Selected spans + duration metric, no export inside layout-critical callback |
| [useReducer](https://react.dev/reference/react/useReducer) | Reducer body and lazy initializer separately, state computation | dispatch call duration is not reducer/render completion; eager/bailout/repeated execution is possible | Reducer/site id and scheduled action token, not action payload; preserve dispatch identity | Reducer execution spans/histograms + scheduling events/count |
| [useState](https://react.dev/reference/react/useState) | Selected setter scheduling frequency, lazy init/functional updater body | One setter does not imply one render/commit; setter call latency is not downstream render time | State site/update token; never wrap returned setter anew each render; reference tracking has cost | Scheduling event/count; init/updater body spans when selected |
| [useCallback](https://react.dev/reference/react/useCallback) | Identity stability/dependency-change counts separately from callback execution when called | Timing useCallback itself does not measure future callback work; creating a new wrapper can itself destroy identity stability | Site and stable callback identity; WeakMap/explicit stable function strategy; no dependency serialization | Diagnostic identity-change count, selected function execution spans |
| [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) | getSnapshot, subscription setup/cleanup, notification callback body, optional server snapshot | Snapshot read time is not full external-store notification-to-paint latency; reads may repeat | Store/site id, snapshot phase; preserve subscribe/getSnapshot identities and referential cache behavior | Phase-specific spans/histograms/count, links to notification where known |
| Custom hook | Inclusive synchronous hook function body, nested selected synchronous calls | Returned values/callback lifetime/effect/network work are not included; nested uninstrumented work cannot be separated | Build/site/component and nesting stack; deeper instrumentation multiplies cost | Inclusive span + exclusive measurement only with known children |

Never insert hooks inside timing callbacks or change hook ordering. A generic wrapper around every `use*` call can violate hook lint/compiler assumptions and accidentally time registration instead of actual work. Do not monkey-patch React exports globally.

## Custom hooks: identity and double counting

Use an explicitly assigned logical site id for conference-critical hooks. Future build metadata maps `{build, source-relative-path, export, source-range, hook-kind, ordinal}` to stable site keys and source locations. Range/ordinal identifies one build but is not intrinsically stable across refactors; cross-build matching needs explicit IDs or an audited map, with “unmatched” rather than guessed equivalence. Minified names and displayName alone are insufficient. Observer can show safe source metadata before a full source-map service exists. Keep file paths/build ids out of general metric dimensions.

For synchronous nesting, inclusive = end − start; exclusive = inclusive − union of known child intervals clipped to parent. In one synchronous stack children normally do not overlap; union still avoids future double subtraction. Existing [selfTimes](../../../packages/next-observer/ui/src/lib/trace-analysis.ts#L19) is reusable for interval accounting, but it gives uncovered wall time, **not CPU**. Record coverage/measurement source. An outer custom hook, inner useMemo, component function and Profiler subtree can all include the same work; their values must not be added. Async callbacks/effects executed later have their own intervals, not subtractions from an already finished hook invocation.

Component ownership should be passed explicitly for the MVP. Ambient synchronous instrumentation context can describe a call stack, but does not expose React's fiber identity or reliably identify the committed instance after concurrent retries. Hook spans should include attempt outcome unknown/uncommitted when no supported commit linkage exists.

## Strategy comparison

| Approach | Coverage | Feasibility / production considerations | Decision |
|---|---|---|---|
| A. Manual selected work | Known memo computations, reducers, effect setup/cleanup, interactions | Uses stable application/OTel APIs; portable W/R; visible measurement boundaries; cannot discover every hook automatically | Conference default |
| B. Babel callsite transform | Selected callback bodies and source IDs | Existing Babel infrastructure reusable, but current public loader is Next-oriented. Requires aliases/import resolution, TS/JSX, scope, directives, async/generator, errors, dependencies, identity and source-map testing | Later opt-in diagnostic prototype |
| C. DevTools / profiling interfaces | Components, commits, scheduler/effects, sampled function attribution | Useful independent validation; development/profiling build constraints. DevTools hook/renderer protocol is not a stable production instrumentation API ([source overview](https://github.com/facebook/react/blob/main/packages/react-devtools/OVERVIEW.md)) | Use as reference evidence, not MVP runtime dependency |
| D. React internals | Potential fiber/dispatcher-level detail | Private interfaces and compiler changes, renderer/version coupling, purity/compatibility risks, larger validation matrix | Defer |

Manual means selected operation bodies, not adding one extra abstraction around arbitrary hooks. The existing `__observe.run` API accepts only name/kind/file/callback and does not expose the full proposed performance attributes; conference apps can use OTel API directly before a small additive Observe helper is designed.

## React Compiler

Official [installation guidance](https://react.dev/learn/react-compiler/installation) requires React Compiler first in the Babel pipeline so it analyzes original source. Existing Observe runs its own Babel pass in a Turbopack loader with `babelrc:false` and `configFile:false` ([transform/index.ts:27–38](../../../packages/next-observe/src/transform/index.ts#L27)); its relation to a later framework compiler pass is not established by a plugin-list ordering claim.

Telemetry wrappers may introduce observable side effects, allocations and changed callback identities that influence memoization/optimization or force compiler bailouts. Running after the compiler avoids changing compiler input but loses original hook locations and may not see hooks transformed into generated cache operations. Do not intercept compiler-generated memoization as a supported API. Preserve compiler directives; do not claim that wrapping the body in another callback is compiler-neutral.

Safest experiment: use manual timers in selected business computations, explicit source ids, and separately documented compiler-off/compiler-on builds. Compare generated output and compiler diagnostics, render counts, callback identities, dependency behavior and workload results. Compiler-first plus a later opt-in transform is a research candidate only after those checks. Use explicit compiler opt-out for nominated diagnostic regions if needed and record it; never silently compare differently optimized artifacts as an instrumentation-overhead result. [Compiler design source](https://github.com/facebook/react/blob/main/compiler/docs/DESIGN_GOALS.md) is a useful reference, not a compatibility promise.

## Overhead and production feasibility

Diagnostic mode keeps selected invocation spans, attempts, phase and source context, bounded buffers, and profiling-build flags. Production-like mode aggregates selected durations/counts, samples coherent interactions and retains slow-operation examples. A clock-only measurement path should first write compact records to a bounded ring; serialization/export runs outside hot render/effect paths. Creating full OTel spans for every hook in every component is not the default design.

Head sampling can reduce exported spans but cannot remove already executed wrappers/clock calls. Thresholding only after an operation ends saves recording/export, not the two clocks or per-call bookkeeping. Use preselected sites, selected sessions and mode-specific no-op paths. Tail sampling would require buffering already-recorded traces and downstream collector support; current receiver has no such policy. Measure disabled versus clock-only, aggregation, spans-no-export, serialization and actual export modes to isolate cost. Full method is in [experiment F](EXPERIMENT_SUPPORT.md#f-instrumentation-overhead).

Production hook timing is technically feasible for **explicit selected bodies**, subject to workload validation, privacy/cardinality and measured overhead. Automatic complete hook attribution, causal render mapping and compiler-neutral instrumentation remain unproven. Corroborate a hook bottleneck by a controlled computation change and repeated interaction results, not temporal coincidence.
