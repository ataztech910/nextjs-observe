// Countdown for hands-on cards. The clocks live outside React, keyed by card: leaving a card for a question from the
// room and coming back finds its timer where it was, still running.

export type TimerState = {
  remainingMs: number;
  running: boolean;
  started: boolean;
  done: boolean;
};

type Clock = { totalMs: number; remainingMs: number; endsAtMs?: number };

const clocks = new Map<string, Clock>();

function clock(id: string, minutes: number): Clock {
  const totalMs = Math.round(minutes * 60_000);
  let c = clocks.get(id);
  // A card whose minutes were edited starts over.
  if (!c || c.totalMs !== totalMs) {
    c = { totalMs, remainingMs: totalMs };
    clocks.set(id, c);
  }
  return c;
}

export function readTimer(
  id: string,
  minutes: number,
  nowMs: number,
): TimerState {
  const c = clock(id, minutes);
  const remainingMs =
    c.endsAtMs === undefined ? c.remainingMs : Math.max(0, c.endsAtMs - nowMs);
  return {
    remainingMs,
    running: c.endsAtMs !== undefined && remainingMs > 0,
    started: c.endsAtMs !== undefined || c.remainingMs !== c.totalMs,
    done: remainingMs === 0,
  };
}

/** Start, or pause — one key for both. A finished timer starts over. */
export function toggleTimer(id: string, minutes: number, nowMs: number): void {
  const c = clock(id, minutes);
  const state = readTimer(id, minutes, nowMs);
  if (state.done) {
    c.remainingMs = c.totalMs;
    c.endsAtMs = nowMs + c.totalMs;
  } else if (state.running) {
    c.remainingMs = state.remainingMs;
    delete c.endsAtMs;
  } else c.endsAtMs = nowMs + c.remainingMs;
}

export function resetTimer(id: string): void {
  clocks.delete(id);
}

/** "15:00", "0:07" — minutes do not need a leading zero on a slide. */
export function formatRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** When the presenter's controller rumbles: one minute left, and five seconds left. */
export const TIMER_WARNINGS = [
  { name: "one-minute", atMs: 60_000 },
  { name: "five-seconds", atMs: 5_000 },
] as const;
export type TimerWarning = (typeof TIMER_WARNINGS)[number]["name"];

/**
 * The warnings a running countdown passed between two readings — each fires once, when the remaining time drops to or
 * below its mark. A timer started below a mark (or reset back above it) does not count as passing it.
 */
export function passedWarnings(previousMs: number, nowMs: number): TimerWarning[] {
  return TIMER_WARNINGS.filter((w) => previousMs > w.atMs && nowMs <= w.atMs).map((w) => w.name);
}
