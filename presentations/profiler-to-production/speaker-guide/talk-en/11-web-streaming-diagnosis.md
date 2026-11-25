# 11 · Which events explain the missing action?

`step: web-streaming-diagnosis` · Web: the button is there, the code is not · **6:10 → 7:00** (0:50)

**On screen:** timeline of one run: click at 785 ms, recommendations in the DOM at 3015 ms, client code starts at 3037 ms. The orange area means the button is visible, but the code has not started.
**Purpose:** put three witnesses on the page that do not depend on its application code, and read their observations in order. Discovery: at the time of the click, the application code had not started. End with the suspicious coincidence: the code started just after the recommendations.

## Script

We need witnesses that don’t depend on the page’s application code. We added three. *(point to the timeline)*

The first is a document-wide click handler. It recorded the click at 785 milliseconds. No sorting followed.

The second watches the DOM. It saw the recommendations appear at 3015 milliseconds.

The third is a mark at the very beginning of the client code. It fired at 3037.

Now read them in order. The shopper clicked at 785. The page’s code started running at 3037. For more than two seconds, the button was on screen, but the code that should respond to it had not started. Nothing was listening for the click to sort the list.

Then the shopper clicks again, and sorting works. To them, it looks like a random glitch: “It didn’t register the first time.”

And one more detail. The code started twenty-two milliseconds after the recommendations. The same recommendations we don’t need for sorting.

## Transition

> Coincidence? Let’s open a tool that can see inside the browser.

## If asked

This is one recorded run from a series of six. The marks use the same browser clock, relative to navigation. DOM insertion is not painting, and this is not a measurement of hydration duration.
