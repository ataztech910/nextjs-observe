import { describe, expect, it } from "vitest";

import type { Step } from "@/deck/types";
import { deck } from "@/deck/deck";
import { resolveJump } from "@/lib/jump";

const ids = new Set(["method", "map", "end"]);
const has = (id: string) => ids.has(id);
const method: Step = { id: "method", focus: ["method"] };
const map: Step = { id: "map", focus: ["map"], jump: { to: "method", exit: "end" } };

describe("resolveJump", () => {
  it("jumps from the map to the method card and remembers the exit there", () => {
    expect(resolveJump(map, null, has)).toEqual({ to: "method", exit: { at: "method", to: "end" } });
  });

  it("goes on to the exit only when the method card was reached by the jump", () => {
    expect(resolveJump(method, { at: "method", to: "end" }, has)).toEqual({ to: "end", exit: null });
    expect(resolveJump(method, null, has)).toBeNull();
  });

  it("ignores an exit remembered for another card and unknown targets", () => {
    expect(resolveJump(method, { at: "map", to: "end" }, has)).toBeNull();
    expect(resolveJump({ id: "x", focus: ["x"], jump: { to: "nowhere" } }, null, has)).toBeNull();
  });

  it("is set on the toolkit map in the talk: framework-choice, then the closing card", () => {
    const withJump = deck.steps.filter((s) => s.jump);
    expect(withJump.map((s) => [s.id, s.jump])).toEqual([["toolkit-map", { to: "framework-choice", exit: "thank-you" }]]);
  });
});
