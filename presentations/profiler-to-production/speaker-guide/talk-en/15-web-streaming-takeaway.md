# 15 · Visible content is not a working action.

`step: web-streaming-takeaway` · Web: the button is there, the code is not · **9:30 → 10:10** (0:40)

**On screen:** Outcome / Diagnosis / Decision for the web case, plus “async is a candidate, not a universal solution.”
**Purpose:** return to the team from slides seven and eight and explain what it now knows. Explain separately why people cannot simply copy async into their applications. End with the main web takeaway.

## Script

Back to the team. What do they know now that they didn’t know when they opened Lighthouse?

First, which number to watch. Not the hundred points or INP. The shopper’s question is: did the early click work, and is the order correct? We now have that number: zero out of six, and six out of six.

Second, where the cause came from. Scores didn’t reveal it. Timing did: when the code started relative to a document arriving in chunks. Timing here is a tool for investigation, not the outcome.

Third, `async` is a candidate here, not a recipe. That script doesn’t wait for the document. If your code expects an element to already be in the DOM, or another script to have run first, it can break. That didn’t happen in our scene—we checked. You’ll need to check again in your own application.

And the main takeaway from the web case: a visible button is not yet a working button.

## Transition

> Our example is custom-built. What does the framework you use every day do?

## If asked

We do not know how often this happens to real users. This is a lab result. Hydration cost was not measured.
