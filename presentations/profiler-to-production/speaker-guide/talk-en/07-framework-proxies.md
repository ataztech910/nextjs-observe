# 07 · What can this number prove?

`step: framework-proxies` · Why this happens · **3:40 → 4:20** (0:40)

**On screen:** Lighthouse score, bundle size, React actualDuration—and what each can prove.
**Purpose:** the shopper complains; the team checks its usual numbers. Three checks, three honest green answers, but the shopper is still waiting. The React point sets up the RN case; do not reveal it yet.

## Script

The shopper contacts support: “I clicked, and nothing happened.” The issue reaches the team.

The first thing they open is Lighthouse. A hundred points. The report covers loading, and loading is fine. It never gets as far as the click.

Someone suggests making the bundle smaller. Sure. But bundle size tells us how much code we sent. The shopper was asking whether the code they needed had run by the time they clicked.

So the team opens React Profiler and checks how long rendering took. The profiler honestly shows rendering inside the component tree. But between the click and the list on screen, there may be work outside that tree.

Three checks, three honest answers. We could improve each number and call it a win. But nobody has measured the click and the list on screen. The shopper is still waiting.

## Transition

> So we shouldn’t start with the numbers we already have. We need a different order.
