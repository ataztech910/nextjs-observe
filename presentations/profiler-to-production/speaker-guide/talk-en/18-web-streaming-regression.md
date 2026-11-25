# 18 · Can the measurement catch the regression?

`step: web-streaming-regression` · Web: the button is there, the code is not · **11:40 → 12:30** (0:50)

**On screen:** three pairs of runs. Async: 3 / 3 confirmed within 1.2 s → PASS. Normal module: 0 / 3 → FAIL. Counters delivered through OTLP matched.
**Purpose:** test the check itself: deliberately break the page and confirm that it turns red. Close the web case by returning to the shopper and their support complaint from slide seven.

## Script

You can’t validate a regression check only against working code. You have to try it against broken code.

So we broke the page ourselves. We removed `async` and brought back the original bug. Before running it, we wrote down the rule: the early click must receive confirmation within 1.2 seconds. No confirmation means failure.

Three pairs of runs. With `async`: three confirmations out of three. PASS. Without `async`: zero out of three. FAIL.

The counters delivered through OpenTelemetry matched what the receiver saw. And the check returned an exit code: zero for the working version, one for the broken version. Any CI system understands that.

To be clear, we haven’t run this in a real CI system yet. Only locally. And 1.2 seconds was a choice for this experiment, not a budget for your product.

Back to the shopper. They click “Price: low to high” and get their list. If someone removes that word in the next release, the check turns red before the shopper contacts support.

## Transition

> On the web, the code arrived too late for the button. In the mobile app, it was the other way round.

## If asked

Exit code 2 is reserved for unknown data. Delivery on tab close, CSP, load, and physical painting remain limitations. Sources: research/01-regression-check-result.md, research/streaming-gate-result.json.
