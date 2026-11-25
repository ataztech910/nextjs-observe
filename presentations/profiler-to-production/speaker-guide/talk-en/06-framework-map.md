# 06 · Web: three questions, different measurements.

`step: framework-map` · Why this happens · **3:00 → 3:40** (0:40) · **[can be shortened]**

**On screen:** Open, Act, Move—each with a start, an end, and a source. A note about legacy TTI at the bottom.
**Purpose:** stand beside the shopper with a stopwatch and decide when to start and stop it. This turns the three waits into three measurements. The main discovery: to stop the clock after a click, we need to see the list on screen.

## Script

Suppose I’m standing next to the shopper with a stopwatch. When do I press start, and when do I press stop?

They open the page. Start at navigation. But stop when? Not when the products are painted. Stop when the button they came to use actually works. Lighthouse stops its clock earlier, at rendering.

They click “Price: low to high.” Start at the click. Stop when the sorted list is on screen. And to press stop, we need to see that list. So whatever measures this must see both the click and the screen.

They scroll. A stopwatch won’t help here. We count frames over a specific part of the scroll.

By the way, the talk description mentions TTI. Time to Interactive was a stopwatch like that inside Lighthouse, with its own definition of when to stop. It was removed in Lighthouse 10. If you have your own “app ready” mark, that’s your stopping point. Give it its own name.

*(If running behind, keep the paragraphs about the click and TTI.)*

## Transition

> So far, the stopwatch is only in my hands. What does the team open when the shopper complains?
