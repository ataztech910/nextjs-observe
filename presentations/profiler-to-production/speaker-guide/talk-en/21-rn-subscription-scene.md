# 21 · The screen is gone. What keeps running?

`step: rn-subscription-scene` · RN: the screen is gone, the work continues · **13:40 → 14:30** (0:50)

**On screen:** shortened OrdersScreen code: useEffect subscribes onOrderUpdate to updates; the handler sorts 500 orders. Below: open and close the screen 1, 10, or 30 times, then send 10 updates.
**Purpose:** show the screen and its code, act out the shopper opening and closing it repeatedly, and ask a question everyone will answer with “zero.” Do not identify the bug yet. Just say, “Remember this useEffect.”

## Script

Here’s the “My orders” screen. A shortened version of its code is on the slide. *(point)*

When it opens, the screen subscribes to order updates. An update arrives, the handler finds the order, sorts all five hundred, and updates the list. Ordinary code. Remember this `useEffect`. We’ll come back to it.

Now let’s play the shopper. Open the screen and close it. Once. Then ten times. Then thirty.

After all the screens are closed, ten order updates arrive, one every 200 milliseconds.

Question: how much work should run on behalf of a screen that no longer exists?

*(pause)*

The answer we all expect is zero.

Let me be clear: I deliberately introduced the bug into this scene. A test source sends the updates, not a real websocket. This is an iOS Simulator running Hermes.

## Transition

> Let’s check. First, with the tool a React developer usually opens first: React Profiler.
