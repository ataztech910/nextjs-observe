# 12 · The real profiler: the click came first.

`step: web-streaming-devtools` · Web: the button is there, the code is not · **7:00 → 7:50** (0:50)

**On screen:** Chrome DevTools → Performance screenshot: Event: click at 748 ms, Evaluate module /client.js at 3008 ms, green INP 10 ms on the left. Annotations on the right.
**Purpose:** check the custom witnesses with a standard tool, which confirms the finding. Find a second green metric despite the lost click. End with a clue: the same file starts immediately in the other variant.

## Script

Our witnesses are custom code. Fair question: can a standard profiler see this too?

This is Chrome DevTools, the Performance tab. Same scene, different run, so the numbers are slightly different. *(point)*

Here’s the click, at 748 milliseconds, on the Interactions track. And here, around three seconds, is Evaluate module, client.js. This is when the application code starts running. Same order: click first, code later. More than two seconds between them.

Now look to the left. INP: ten milliseconds, green. The browser processed the click quickly. But the code that sorts the list wasn’t there to handle it yet. That’s our second green indicator in a row, after Lighthouse 100.

One last thing. In the other variant of this page, the same client.js starts at 36 milliseconds. Same code. The only difference is how it’s loaded.

## Transition

> Why does the way we load it make a difference of two seconds? We need to look at how the browser reads a page that arrives in chunks.

## If asked

Evaluate module marks the start of module execution, not the point when all handlers are attached, and not hydration. This is a separate run from the marks at 785 / 3015 / 3037. Do not mix the numbers.
