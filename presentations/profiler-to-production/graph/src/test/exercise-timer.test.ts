import { describe, expect, it } from "vitest";

import {
  formatRemaining,
  passedWarnings,
  readTimer,
  resetTimer,
  toggleTimer,
} from "@/lib/exercise-timer";

const T0 = 1_000_000;

describe("exercise timer", () => {
  it("is ready with the full time until started", () => {
    expect(readTimer("a", 15, T0)).toEqual({
      remainingMs: 900_000,
      running: false,
      started: false,
      done: false,
    });
    expect(readTimer("a", 15, T0 + 60_000).remainingMs).toBe(900_000);
  });

  it("counts down once started, pauses, and goes on from where it stopped", () => {
    toggleTimer("b", 10, T0);
    expect(readTimer("b", 10, T0 + 60_000)).toEqual({
      remainingMs: 540_000,
      running: true,
      started: true,
      done: false,
    });
    toggleTimer("b", 10, T0 + 60_000); // pause
    expect(readTimer("b", 10, T0 + 600_000)).toEqual({
      remainingMs: 540_000,
      running: false,
      started: true,
      done: false,
    });
    toggleTimer("b", 10, T0 + 600_000); // resume
    expect(readTimer("b", 10, T0 + 660_000).remainingMs).toBe(480_000);
  });

  it("stops at zero and says so", () => {
    toggleTimer("c", 1, T0);
    expect(readTimer("c", 1, T0 + 60_000)).toEqual({
      remainingMs: 0,
      running: false,
      started: true,
      done: true,
    });
    expect(readTimer("c", 1, T0 + 600_000).remainingMs).toBe(0);
  });

  it("a finished timer starts over on the next start", () => {
    toggleTimer("d", 1, T0);
    toggleTimer("d", 1, T0 + 120_000);
    expect(readTimer("d", 1, T0 + 130_000)).toEqual({
      remainingMs: 50_000,
      running: true,
      started: true,
      done: false,
    });
  });

  it("reset brings back the full time; cards keep their own clocks", () => {
    toggleTimer("e", 5, T0);
    toggleTimer("f", 5, T0);
    resetTimer("e");
    expect(readTimer("e", 5, T0 + 60_000)).toEqual({
      remainingMs: 300_000,
      running: false,
      started: false,
      done: false,
    });
    expect(readTimer("f", 5, T0 + 60_000).remainingMs).toBe(240_000);
  });

  it("a card whose minutes were edited starts over", () => {
    toggleTimer("g", 5, T0);
    expect(readTimer("g", 20, T0 + 60_000)).toEqual({
      remainingMs: 1_200_000,
      running: false,
      started: false,
      done: false,
    });
  });

  it("formats what is left, rounding up so 0:00 means done", () => {
    expect(
      [900_000, 61_000, 60_000, 59_001, 1, 0].map(formatRemaining),
    ).toEqual(["15:00", "1:01", "1:00", "1:00", "0:01", "0:00"]);
  });
});

describe("timer warnings for the controller", () => {
  it("passes one minute and five seconds once each, on the way down", () => {
    expect(passedWarnings(61_000, 60_500)).toEqual([]);
    expect(passedWarnings(60_100, 59_900)).toEqual(["one-minute"]);
    expect(passedWarnings(59_900, 59_600)).toEqual([]);
    expect(passedWarnings(5_200, 4_950)).toEqual(["five-seconds"]);
    expect(passedWarnings(4_950, 4_700)).toEqual([]);
  });

  it("exactly on the mark counts; a reset back up does not", () => {
    expect(passedWarnings(60_250, 60_000)).toEqual(["one-minute"]);
    expect(passedWarnings(3_000, 180_000)).toEqual([]);
  });

  it("a long gap between readings passes both", () => {
    expect(passedWarnings(70_000, 3_000)).toEqual(["one-minute", "five-seconds"]);
  });
});
