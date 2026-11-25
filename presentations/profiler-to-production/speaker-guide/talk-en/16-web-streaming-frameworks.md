# 16 · Why Next.js already does this

`step: web-streaming-frameworks` · Web: the button is there, the code is not · **10:10 → 10:50** (0:40)

**On screen:** Next.js 16.3.8 production build—7 out of 7 client chunks use `<script async>`; the eighth is a noModule polyfill. Below: when the problem returns.
**Purpose:** answer the Next.js developer thinking, “We don’t have this problem.” They are right: the framework already protects them. But you discover that protection only when you move away from it, and Lighthouse will not show you the difference.

## Script

If you use Next.js, you’re probably thinking, “We don’t have this problem.” And you’re right.

I built a production version with Next.js 16 and opened the HTML. Seven client scripts out of seven use `async`. The eighth is a polyfill for older browsers. The framework has already made the fix we just worked out ourselves.

So you already have this protection, perhaps without knowing it. You notice it when you move away from it. Your own streaming server. Your own entry with `type="module"` and no `async`. The button starts waiting again. Lighthouse still gives you a hundred.

So when you change frameworks or build settings, check the action, not the score.

I only checked Next.js 16.3.8, on one page. I won’t make claims about other frameworks.

## Transition

> We found the cause in the lab. How would we spot this after release, for real people?

## If asked

Pages Router, Vite SSR, Remix, and others were not tested. Check: `next build` + `next start`, Porto Shop home page HTML, 20 November 2026.
