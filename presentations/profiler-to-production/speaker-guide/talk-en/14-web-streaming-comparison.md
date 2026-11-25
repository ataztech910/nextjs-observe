# 14 · Same early click. Different result.

`step: web-streaming-comparison` · Web: the button is there, the code is not · **8:40 → 9:30** (0:50)

**On screen:** two actual screenshots after an early click; recommendations are still loading in both. Normal module on the left: original order. Async on the right: sorted. Labels: 6/6 and 6/6.
**Purpose:** test the hypothesis as agreed on slide eight: same click, same page, same number—and the list must remain correct. The hypothesis is confirmed.

## Script

Two copies of the same page. Same code, same three-second delay for recommendations. One word differs in the script tag: a normal module on the left, `async` on the right.

In both, we click “Price: low to high” at around 700 milliseconds. In both screenshots, recommendations are still loading. *(point)*

On the left, the original order: lamp, notebook, mug. On the right: notebook, mug, lamp. Sorted.

One screenshot proves nothing. So we ran six pairs and alternated which variant went first. Normal module: early click lost six times out of six. `async`: correct order before the recommendations arrived, six out of six.

And remember our agreement at the start: the list must stay correct. It did. At the end of all twelve runs, the order was correct, with no errors.

The hypothesis held up. The recommendations were holding up the button.

## Transition

> So one word fixes everything? Not quite.

## If asked

Chrome 157 headless, localhost, production React build, 3000 ms delay, click after 700 ms. This is a lab comparison, not production data or a measurement of hydration cost.
