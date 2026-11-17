import { useCallback, useEffect, useMemo, useState } from "react";
import type { Choice, Deck, Step } from "@/deck/types";
import { stepNumber } from "@/lib/step-number";

export type Mode = "step" | "overview" | "choosing";

export function useDeckNav(deck: Deck) {
  const nodeIds = useMemo(() => new Set(deck.nodes.map((n) => n.id)), [deck]);

  // Drop steps whose focus ids don't exist.
  const steps = useMemo(
    () =>
      deck.steps.filter((s) => {
        const missing = s.focus.filter((f) => !nodeIds.has(f));
        if (missing.length) console.warn(`[deck] step "${s.id}" skipped, unknown nodes:`, missing);
        return missing.length === 0 && s.focus.length > 0;
      }),
    [deck, nodeIds],
  );
  const byId = useMemo(() => new Map(steps.map((s, i) => [s.id, { s, i }])), [steps]);

  const nextOf = useCallback(
    (s: Step): string | null => {
      if (s.next !== undefined) return s.next && byId.has(s.next) ? s.next : null;
      return steps[(byId.get(s.id)?.i ?? -1) + 1]?.id ?? null;
    },
    [steps, byId],
  );

  // stepId -> branch choice (key) and its branch point
  const branchOf = useMemo(() => {
    const m = new Map<string, { choice: Choice; point: Step }>();
    for (const point of steps) {
      for (const c of point.choices ?? []) {
        let cur = byId.get(c.goToStep)?.s;
        let guard = 0;
        while (cur && guard++ < 50) {
          m.set(cur.id, { choice: c, point });
          if (cur.returnToStep) break;
          const n = nextOf(cur);
          cur = n ? byId.get(n)?.s : undefined;
        }
      }
    }
    return m;
  }, [steps, byId, nextOf]);

  const [stepId, setStepId] = useState(steps[0]?.id ?? "");
  const [history, setHistory] = useState<string[]>([]);
  const [visited, setVisited] = useState<string[]>([]);
  const [overview, setOverview] = useState(false);
  const [traversed, setTraversed] = useState<string[]>([]);

  const step = byId.get(stepId)?.s ?? steps[0]!;
  const index = byId.get(step.id)?.i ?? 0;
  const branch = branchOf.get(step.id);
  const mode: Mode = overview ? "overview" : step.choices ? "choosing" : "step";

  const markTraversed = useCallback(
    (a: Step, b: Step) => {
      const A = new Set(a.focus);
      const B = new Set(b.focus);
      const keys = deck.edges
        .filter((e) => (A.has(e.from) && B.has(e.to)) || (B.has(e.from) && A.has(e.to)))
        .map((e) => `${e.from}>${e.to}`);
      if (keys.length) setTraversed((t) => Array.from(new Set([...t, ...keys])));
    },
    [deck.edges],
  );

  const goTo = useCallback(
    (id: string) => {
      const target = byId.get(id)?.s;
      if (!target || id === step.id) {
        setOverview(false);
        return;
      }
      markTraversed(step, target);
      setHistory((h) => [...h, step.id]);
      setStepId(id);
      setOverview(false);
    },
    [byId, step, markTraversed],
  );

  const choose = useCallback(
    (key: string) => {
      const c = step.choices?.find((x) => x.key === key);
      if (!c) return;
      setVisited((v) => (v.includes(key) ? v : [...v, key]));
      goTo(c.goToStep);
    },
    [step, goTo],
  );

  const continueId = step.choices ? nextOf(step) : null;
  const allVisited = !!step.choices && step.choices.every((c) => visited.includes(c.key));

  const next = useCallback(() => {
    if (overview) return setOverview(false);
    if (step.choices) {
      const un = step.choices.find((c) => !visited.includes(c.key));
      if (un) return choose(un.key);
      if (continueId) goTo(continueId);
      return;
    }
    if (step.returnToStep && byId.has(step.returnToStep)) return goTo(step.returnToStep);
    const n = nextOf(step);
    if (n) goTo(n);
  }, [overview, step, visited, choose, continueId, goTo, byId, nextOf]);

  const back = useCallback(() => {
    if (overview) return setOverview(false);
    const last = history[history.length - 1];
    if (last) {
      setStepId(last);
      setHistory(history.slice(0, -1));
      return;
    }
    // No trail (e.g. opened straight on this step via the URL): fall back to the
    // previous spine step so going back always works during a talk.
    const prev = steps[index - 1];
    if (prev) setStepId(prev.id);
  }, [overview, history, steps, index]);

  const home = useCallback(() => goTo(steps[0]!.id), [goTo, steps]);

  const goToNode = useCallback(
    (nodeId: string) => {
      const single = steps.find((s) => s.focus.length === 1 && s.focus[0] === nodeId);
      const any = single ?? steps.find((s) => s.focus.includes(nodeId));
      if (any) goTo(any.id);
    },
    [steps, goTo],
  );

  // URL hash
  useEffect(() => {
    const p = new URLSearchParams(window.location.hash.slice(1));
    const s = p.get("step");
    if (s && byId.has(s)) setStepId(s);
    if (new URLSearchParams(window.location.search).get("overview") === "1") setOverview(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const p = new URLSearchParams();
    p.set("step", step.id);
    if (branch) p.set("branch", branch.choice.key);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${p}`);
  }, [step.id, branch]);

  return {
    steps,
    step,
    index,
    ...stepNumber(steps, step.id),
    mode,
    overview,
    setOverview,
    history,
    visited,
    traversed,
    branch,
    allVisited,
    continueId,
    goTo,
    goToNode,
    choose,
    next,
    back,
    home,
  };
}
export type DeckNav = ReturnType<typeof useDeckNav>;
