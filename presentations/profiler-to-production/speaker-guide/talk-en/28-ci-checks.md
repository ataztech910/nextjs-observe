# 28 · Two checks. Both fail on the bug.

`step: ci-checks` · Keeping the bugs out · **19:15 → 20:00** (0:45)

**On screen:** code for two checks, with actual failure messages: `expected 30 to be 0` and `Expected "Sorted by price", Received "Original order"`.
**Purpose:** read the tests as a replay of the shopper’s actions: thirty visits and an early click. Show that each error message contains one of today’s stories in a single line.

## Script

The first check is for the orders screen. *(point)* Open and close it thirty times, just like our shopper. Count the subscribers. Expect zero.

On the buggy version, the test fails: “expected thirty to be zero.” Exactly thirty forgotten subscriptions, one for every visit.

The second check is for the page. Open it and click “Price: low to high” without waiting for the rest. Expect “Sorted by price.”

With the normal module: “Received: Original order.” The same click after which nothing happened.

Look at those two messages. They’re both stories from today’s talk, each in one line.

And Lighthouse gives both versions of that page the same hundred points. Only the behaviour check tells them apart.

## Transition

> You can take both checks home with you.

## If asked

The hook test runs in jsdom, using Vitest and Testing Library. In an RN app, the same hook check would use renderHook from @testing-library/react-native; that was not tested in RN. Bugs are enabled with HOOK=leaky and SCRIPT=module.
