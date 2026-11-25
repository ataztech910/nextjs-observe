# 20 · React Native: ready, responsive, smooth?

`step: framework-native` · Bridge · **13:00 → 13:40** (0:40)

**On screen:** Ready—native launch → usable screen, cold and warm. Responsive—touch → visible correct result; JS / React callback is an intermediate point. Smooth—native frame timing, with JS pauses measured separately.
**Purpose:** bring the stopwatch from slide six onto the phone. The main new trap: stopping it at the JS handler instead of the screen. The last line sets up the RN case: JS runs even when nothing changes on screen.

## Script

The stopwatch from the web slide is now on a phone. The same three moments for our shopper.

They open the app. Start when the operating system begins launching it. Stop at a screen they can use. First question: is this a cold start or a warm start? Those are different numbers. We can’t combine them into one.

They tap. Start at the touch. Stop at the correct result on screen. It’s easy to stop the clock too early here: when the JS handler runs, or when React finishes rendering. That’s a useful point along the way, but it isn’t the end. There’s still work between that point and the screen.

They scroll. Here, we count native frames during a specific scenario. What the JS thread was doing at the same time is a separate question, for a separate tool.

And remember this last point: JavaScript can be running even when nothing changes on screen.

## Transition

> That’s what our second case is about. The orders screen.
