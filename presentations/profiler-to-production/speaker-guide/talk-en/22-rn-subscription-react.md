# 22 · React: no renders from the closed screen.

`step: rn-subscription-react` · RN: the screen is gone, the work continues · **14:30 → 15:20** (0:50)

**On screen:** actual React Native DevTools Profiler capture, Ranked view, commit 87 of 173—the start of the stream in leak/30. Right: App and UI, 3.5 ms in Debug; OrdersScreen is absent; the next 10 updates produce 0 commits.
**Purpose:** React Profiler confirms the audience’s expectation: the closed screen is silent. This is the third honest green report. End with doubt, recalling slide seven: no renders does not mean no work.

## Script

This is an actual React Profiler recording. The same scene, thirty visits. *(point)*

Here’s the commit at the start of the updates. App, buttons, text—the scenario’s interface has switched to the next phase. Three and a half milliseconds, in a Debug build. OrdersScreen isn’t on the list. All thirty screens are closed. React has nothing to draw for them.

Then ten updates arrive. New commits: zero. The next commit in the recording belongs to the next phase of the scenario.

React confirms what we expected: the closed screen is silent. That’s our third green report today, after Lighthouse and INP.

And it’s honest too. React Profiler shows renders. The closed screen really didn’t render anything.

But remember what we said about React Profiler at the start? There may be work outside the component tree. No renders doesn’t mean no work.

## Transition

> To find out whether JavaScript is running, we need the engine’s profiler: Hermes.

## If asked

173 commits is the entire recorded run, including opening and closing screens. Commit 87 comes from the scenario changing phase, not an update handler. Other UI could render during other streams—for example, a button animation in the one-visit scenario. Do not say “the profiler is empty.” The 3.5 ms value is from Debug and must not be compared with Release numbers.
