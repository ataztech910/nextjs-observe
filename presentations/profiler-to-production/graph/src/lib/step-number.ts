import type { Step } from "@/deck/types";

// The "Step N / M" counter counts the main line only. Branch steps (returnToStep) sit after the last card in the array,
// so counting them shows "54 / 59" with nothing after 54; a branch shows the number of the step it returns to.

export function stepNumber(steps: Step[], id: string): { number: number; total: number } {
  const main = steps.filter((s) => !s.returnToStep);
  const step = steps.find((s) => s.id === id);
  const target = step?.returnToStep ?? id;
  return { number: main.findIndex((s) => s.id === target) + 1 || 1, total: main.length };
}
