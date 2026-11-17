import { AnimatePresence, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deck } from "@/deck/deck";
import { NODE_WIDTH, PHOTO_CARD } from "@/deck/types";
import { useCamera, type Box } from "@/hooks/useCamera";
import { useDeckNav } from "@/hooks/useDeckNav";
import { useGamepad } from "@/hooks/useGamepad";
import { useKeyboard } from "@/hooks/useKeyboard";
import { BottomBar, type Crumb } from "./BottomBar";
import { Canvas } from "./Canvas";
import { Chooser } from "./Chooser";
import { EdgeLayer } from "./EdgeLayer";
import { HandOff } from "./HandOff";
import { HelpOverlay } from "./HelpOverlay";
import { NodeCard, type Tier } from "./NodeCard";
import { PresenterNotes } from "./PresenterNotes";
import { ExerciseTimer } from "./ExerciseTimer";
import { passedWarnings, readTimer, resetTimer, toggleTimer } from "@/lib/exercise-timer";
import { TopBar } from "./TopBar";

type Size = { w: number; h: number };

export function Presentation() {
  const reduced = !!useReducedMotion();
  const nav = useDeckNav(deck);
  const cam = useCamera(reduced);
  const nodeById = useMemo(() => new Map(deck.nodes.map((n) => [n.id, n])), []);
  const stepById = useMemo(() => new Map(nav.steps.map((s) => [s.id, s])), [nav.steps]);

  const [sizes, setSizes] = useState<Record<string, Size>>({});
  const onSize = useCallback((id: string, w: number, h: number) => {
    setSizes((p) => (p[id] && p[id].w === w && p[id].h === h ? p : { ...p, [id]: { w, h } }));
  }, []);

  const [hoverChoice, setHoverChoice] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  // Presenter notes are on by default; N hides them.
  // Hidden until the presenter presses N — the room sees the slides, not the notes.
  const [showNotes, setShowNotes] = useState(false);
  const [intro, setIntro] = useState(true);

  const { step, mode, overview } = nav;
  const choosing = mode === "choosing";
  const focus = useMemo(() => new Set(step.focus), [step]);
  const singleFocus = step.focus.length === 1 ? nodeById.get(step.focus[0] ?? "") : undefined;
  const expandedId = !overview && !intro && singleFocus?.detail ? singleFocus.id : null;
  // A card with a countdown, while it is the one on screen.
  const timed = !overview && !intro && singleFocus?.timer ? singleFocus : null;

  // choice target node ids
  const candidates = useMemo(() => {
    const m = new Map<string, { key: string; i: number }>();
    if (!choosing) return m;
    step.choices!.forEach((c, i) => {
      const target = stepById.get(c.goToStep)?.focus[0];
      if (target) m.set(target, { key: c.key, i });
    });
    return m;
  }, [choosing, step, stepById]);
  const hoverNode = useMemo(() => {
    for (const [id, c] of candidates) if (c.key === hoverChoice) return id;
    return null;
  }, [candidates, hoverChoice]);

  const neighbors = useMemo(() => {
    const s = new Set<string>();
    for (const e of deck.edges) {
      if (focus.has(e.from)) s.add(e.to);
      if (focus.has(e.to)) s.add(e.from);
    }
    return s;
  }, [focus]);

  // Edge sets
  const traversed = useMemo(() => new Set(nav.traversed), [nav.traversed]);
  const activeEdges = useMemo(() => {
    const s = new Set<string>(traversed);
    if (!overview)
      for (const e of deck.edges) if (focus.has(e.from) && focus.has(e.to)) s.add(`${e.from}>${e.to}`);
    return s;
  }, [traversed, focus, overview]);
  const hotEdges = useMemo(() => {
    const s = new Set<string>();
    if (hoverNode) for (const e of deck.edges) if (e.to === hoverNode && focus.has(e.from)) s.add(`${e.from}>${e.to}`);
    return s;
  }, [hoverNode, focus]);

  // Camera
  const vpRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const instant = useRef(true);
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      instant.current = true;
      setVp({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const measured = Object.keys(sizes).length >= deck.nodes.length;

  const bbox = useCallback(
    (ids: string[]): Box => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const id of ids) {
        const n = nodeById.get(id);
        if (!n) continue;
        const s = sizes[id] ?? { w: NODE_WIDTH[n.size ?? "md"], h: 140 };
        x0 = Math.min(x0, n.x);
        y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x + s.w);
        y1 = Math.max(y1, n.y + s.h);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },
    [nodeById, sizes],
  );

  useEffect(() => {
    if (!vp.w || !measured) return;
    const all = intro || overview;
    const ids = all ? deck.nodes.map((n) => n.id) : step.focus;
    const single = !all && step.focus.length === 1;
    const photoCard = single && !!expandedId && !!singleFocus?.photo;
    cam.fit(bbox(ids), vp, {
      pad: all ? 80 : 120,
      // Presenter notes float over the card (N), so an expanded card gets the full height; only the choices bar needs room.
      padBottom: choosing ? 120 : 0,
      zoom: all ? undefined : step.zoom,
      factor: intro ? 0.9 : 1,
      minScale: all ? 0.05 : 0.35,
      // A card with a photo is shaped for the screen (PHOTO_CARD) and fills it; others keep the old margins.
      fillH: single ? (photoCard ? PHOTO_CARD.fill.h : 0.8) : undefined,
      fillW: single ? (photoCard ? PHOTO_CARD.fill.w : 0.72) : undefined,
      alignLeft: single ? 0.04 : undefined,
      animate: !instant.current,
    });
    instant.current = false;
  }, [vp, measured, intro, overview, step, bbox, expandedId, choosing, cam, singleFocus]);

  // Intro: hold overview, then glide
  useEffect(() => {
    if (!measured || !vp.w || !intro) return;
    const t = setTimeout(() => setIntro(false), 600 + 400);
    return () => clearTimeout(t);
  }, [measured, vp.w, intro]);

  const toggleOverview = useCallback(() => nav.setOverview(!overview), [nav, overview]);
  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  /* ---------------- hand-off to the live app ---------------- */

  const [handingOff, setHandingOff] = useState(false);

  /**
   * One way out of the deck, used by every "next": keyboard, controller, click.
   * A step with `handOff` asks before it leaves, because leaving cannot be
   * undone — see HandOff.
   */
  const goNext = useCallback(() => {
    if (step.handOff) {
      setHandingOff(true);
      return;
    }
    nav.next();
  }, [step.handOff, nav]);

  const confirmHandOff = useCallback(() => {
    const url = step.handOff?.url;
    if (url) window.location.assign(url);
  }, [step.handOff]);

  /* ---------------- Xbox controller ---------------- */

  // At a branch point the D-pad moves a highlight and A confirms it, so the
  // whole talk can be driven without touching the laptop.
  const gamepadNext = useCallback(() => {
    // The hand-off prompt speaks the pad's language: A confirms it.
    if (handingOff) {
      confirmHandOff();
      return;
    }
    if (choosing && hoverChoice) {
      nav.choose(hoverChoice);
      setHoverChoice(null);
      return;
    }
    goNext();
  }, [handingOff, confirmHandOff, choosing, hoverChoice, nav, goNext]);

  const gamepadBack = useCallback(() => {
    // B backs out of the hand-off, the same as Escape.
    if (handingOff) {
      setHandingOff(false);
      return;
    }
    // Backing out of a pending choice should cancel it, not leave the step.
    if (choosing && hoverChoice) {
      setHoverChoice(null);
      return;
    }
    nav.back();
  }, [handingOff, choosing, hoverChoice, nav]);

  const stepBranch = useCallback(
    (delta: 1 | -1) => {
      const choices = step.choices;
      if (!choosing || !choices?.length) return;
      const at = choices.findIndex((c) => c.key === hoverChoice);
      // No highlight yet: come in from whichever end the press implies.
      const next = at < 0 ? (delta === 1 ? 0 : choices.length - 1) : (at + delta + choices.length) % choices.length;
      setHoverChoice(choices[next]!.key);
    },
    [choosing, step.choices, hoverChoice],
  );

  const gamepad = useGamepad(
    useMemo(
      () => ({
        onNext: gamepadNext,
        onPrev: gamepadBack,
        onOverview: toggleOverview,
        onNotes: () => setShowNotes((v) => !v),
        onFullscreen: fullscreen,
        onHome: nav.home,
        onBranchStep: stepBranch,
        // The same as T and R: only a card with a timer in focus has one to start or reset.
        onTimerToggle: () => timed?.timer && toggleTimer(timed.id, timed.timer.minutes, Date.now()),
        onTimerReset: () => timed?.timer && resetTimer(timed.id),
      }),
      [gamepadNext, gamepadBack, toggleOverview, fullscreen, nav.home, stepBranch, timed],
    ),
  );

  // A short rumble on every move, so a press is felt rather than checked.
  const lastStepRef = useRef(step.id);
  useEffect(() => {
    if (lastStepRef.current === step.id) return;
    lastStepRef.current = step.id;
    if (gamepad.isActivated) void gamepad.pulseHaptic(0.5, 90);
  }, [step.id, gamepad]);

  // The controller rumbles when the focused card's timer reaches one minute left, and again at five seconds left —
  // the presenter knows without looking at the screen. Only while it runs; each mark once per pass.
  // pulseHaptic is stable; the gamepad object is not — depending on it would restart the watch on every render and
  // could lose the reading just before a mark.
  const { pulseHaptic } = gamepad;
  useEffect(() => {
    if (!timed?.timer) return;
    const { id, timer } = timed;
    let previous = readTimer(id, timer.minutes, Date.now());
    const watch = setInterval(() => {
      const now = readTimer(id, timer.minutes, Date.now());
      if (previous.running) {
        for (const warning of passedWarnings(previous.remainingMs, now.remainingMs)) {
          if (warning === "one-minute") void pulseHaptic(0.7, 400);
          else void pulseHaptic(1, 400).then(() => setTimeout(() => void pulseHaptic(1, 400), 250));
        }
      }
      previous = now;
    }, 250);
    return () => clearInterval(watch);
  }, [timed, pulseHaptic]);

  // Leaving a branch point clears a highlight nobody confirmed.
  useEffect(() => {
    if (!choosing) setHoverChoice(null);
  }, [choosing]);

  useKeyboard((e) => {
    const k = e.key;
    // The hand-off dialog owns the keyboard while it is up.
    if (handingOff) return;
    if (showHelp && (k === "Escape" || k === "?")) {
      setShowHelp(false);
      return;
    }
    if (k === "ArrowRight" || k === " " || k === "PageDown") {
      e.preventDefault();
      goNext();
    } else if (k === "ArrowLeft" || k === "PageUp") {
      e.preventDefault();
      nav.back();
    } else if (/^[1-9]$/.test(k) && choosing) {
      const c = step.choices![Number(k) - 1];
      if (c) nav.choose(c.key);
    } else if (k === "o" || k === "O" || k === "Escape") toggleOverview();
    else if (k === "?") setShowHelp(true);
    else if (k === "n" || k === "N") setShowNotes((v) => !v);
    else if (k === "f" || k === "F") fullscreen();
    // The exercise timer of the card in focus.
    else if ((k === "t" || k === "T") && timed?.timer) toggleTimer(timed.id, timed.timer.minutes, Date.now());
    else if ((k === "r" || k === "R") && timed?.timer) resetTimer(timed.id);
    else if (k === "Home") nav.home();
  });

  const onActivate = useCallback(
    (id: string) => {
      const c = candidates.get(id);
      if (c && !overview) nav.choose(c.key);
      else nav.goToNode(id);
    },
    [candidates, overview, nav],
  );

  const tierOf = (id: string): Tier => {
    if (overview || intro) return "normal";
    if (candidates.has(id)) return "candidate";
    if (focus.has(id)) return "focus";
    if (neighbors.has(id)) return "neighbor";
    return "dim";
  };

  const crumbs: Crumb[] = useMemo(() => {
    const head = nodeById.get(step.focus[0] ?? "");
    const part = step.part ?? "Workshop";
    if (nav.branch) {
      return [
        { label: part },
        { label: "Branch", branch: true },
        { label: nav.branch.choice.label, branch: true },
        { label: head?.title ?? step.id, branch: true },
      ];
    }
    return [{ label: part }, { label: choosing ? "Branch point" : (head?.title ?? step.id) }];
  }, [nav.branch, step, nodeById, choosing]);

  const continueLabel = nav.continueId
    ? nodeById.get(stepById.get(nav.continueId)?.focus[0] ?? "")?.title
    : undefined;

  return (
    <div className="presentation">
      <TopBar
        title={deck.meta.title}
        subtitle={deck.meta.subtitle}
        step={nav.number}
        total={nav.total}
        gamepad={gamepad.isConnected}
      />
      <Canvas ref={vpRef} cam={cam} overview={overview} onNext={goNext} onPrev={nav.back}>
        <EdgeLayer deck={deck} sizes={sizes} active={activeEdges} hot={hotEdges} reduced={reduced} />
        {deck.nodes.map((n, i) => {
          const c = candidates.get(n.id);
          return (
            <NodeCard
              key={n.id}
              node={n}
              tier={tierOf(n.id)}
              expanded={expandedId === n.id}
              keycap={c && !overview ? { n: c.i + 1, i: c.i, visited: nav.visited.includes(c.key) } : undefined}
              hot={hoverNode === n.id}
              introDelay={reduced ? 0 : 0.1 + i * 0.05}
              reduced={reduced}
              viewAspect={vp.w && vp.h ? vp.w / vp.h : 16 / 9}
              onSize={onSize}
              onActivate={onActivate}
            />
          );
        })}
      </Canvas>

      <AnimatePresence>
        {choosing && !overview && !intro && (
          <Chooser
            key={step.id}
            choices={step.choices!}
            visited={nav.visited}
            allVisited={nav.allVisited}
            continueLabel={continueLabel}
            onChoose={nav.choose}
            onContinue={() => nav.continueId && nav.goTo(nav.continueId)}
            onHover={setHoverChoice}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {timed?.timer && <ExerciseTimer key={`timer-${timed.id}`} nodeId={timed.id} minutes={timed.timer.minutes} label={timed.timer.label} />}
      </AnimatePresence>
      <AnimatePresence>
        {showNotes && <PresenterNotes key="notes" note={singleFocus?.detail?.note} title={singleFocus?.title ?? step.id} />}
      </AnimatePresence>
      <AnimatePresence>
        {showHelp && <HelpOverlay key="help" onClose={() => setShowHelp(false)} gamepad={gamepad.isConnected} />}
      </AnimatePresence>
      <AnimatePresence>
        {handingOff && step.handOff && (
          <HandOff
            key="handoff"
            handOff={step.handOff}
            onConfirm={confirmHandOff}
            onCancel={() => setHandingOff(false)}
            gamepad={gamepad.isConnected}
          />
        )}
      </AnimatePresence>

      <BottomBar
        crumbs={crumbs}
        caption={overview ? "Overview — click any card to jump" : step.caption}
        onPrev={nav.back}
        onNext={goNext}
        onOverview={toggleOverview}
        onHelp={() => setShowHelp(true)}
        onNotes={() => setShowNotes((v) => !v)}
        onFullscreen={fullscreen}
      />
    </div>
  );
}
