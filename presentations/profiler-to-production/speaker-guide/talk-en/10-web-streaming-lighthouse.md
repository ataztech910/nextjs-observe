# 10 · Lighthouse: 100. The click is still lost.

`step: web-streaming-lighthouse` · Web: the button is there, the code is not · **5:30 → 6:10** (0:40)

**On screen:** actual Lighthouse report—Performance 100, FCP 0.2 s, LCP 0.2 s, TBT 0 ms, CLS 0.
**Purpose:** present the green report as evidence and find the first clue: TBT is zero, so the thread was not busy. Then do what Lighthouse does not do: click ourselves. The button did not work, and “slow JavaScript” no longer explains it.

## Script

Lighthouse. The same page, the variant that loses the click. A hundred points. Content in two tenths of a second. Total Blocking Time: zero.

Remember that zero. It means the main thread wasn’t occupied for long during loading. The browser wasn’t struggling.

The report is honest. Lighthouse loaded the page and assessed the load. It didn’t click the button.

So we clicked it ourselves. The same variant, with a trace recorded in Chrome. The click arrives around 750 milliseconds. No sorting. It still hadn’t happened by the time the page finished loading.

The thread is free, the button is there, the click arrives. But there’s no result.

## Transition

> To find out what the button was waiting for, let’s add some marks to the page.
