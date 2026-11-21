import type { Step } from "@/deck/types";

// ↑ on a step with `jump` goes to `jump.to`; arrived there by that jump, ↑ again goes to `jump.exit`.
// `exit` is remembered for the landing card only — on a normal pass that card has no ↑ at all.

export type JumpExit = { at: string; to: string } | null;

export function resolveJump(
  step: Step,
  exit: JumpExit,
  has: (id: string) => boolean,
): { to: string; exit: JumpExit } | null {
  if (exit && exit.at === step.id && has(exit.to)) return { to: exit.to, exit: null };
  const j = step.jump;
  if (!j || !has(j.to)) return null;
  return { to: j.to, exit: j.exit && has(j.exit) ? { at: j.to, to: j.exit } : null };
}
