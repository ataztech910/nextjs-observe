import { describe, expect, it } from "vitest";

import type { Step } from "@/deck/types";
import { deck } from "@/deck/deck";
import { stepNumber } from "@/lib/step-number";

const steps: Step[] = [
  { id: "a", focus: ["a"] },
  { id: "pick", focus: ["x", "y"] },
  { id: "end", focus: ["end"], next: null },
  { id: "x", focus: ["x"], returnToStep: "pick" },
  { id: "y", focus: ["y"], returnToStep: "pick" },
];

describe("stepNumber", () => {
  it("counts the main line only", () => {
    expect(stepNumber(steps, "a")).toEqual({ number: 1, total: 3 });
    expect(stepNumber(steps, "end")).toEqual({ number: 3, total: 3 });
  });

  it("gives a branch the number of the step it returns to", () => {
    expect(stepNumber(steps, "y")).toEqual({ number: 2, total: 3 });
  });

  it("ends the workshop deck on its last card", () => {
    const last = deck.steps.find((s) => s.next === null)!;
    const { number, total } = stepNumber(deck.steps, last.id);
    expect(number).toBe(total);
  });
});
