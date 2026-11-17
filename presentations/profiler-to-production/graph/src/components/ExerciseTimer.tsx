import { motion } from "framer-motion";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  formatRemaining,
  readTimer,
  resetTimer,
  toggleTimer,
} from "@/lib/exercise-timer";

/**
 * The countdown on a hands-on card: the room sees when the exercise started and how long is left.
 * `T` starts and pauses it, `R` resets; it is drawn over the canvas, so it stays readable at any zoom.
 */
export function ExerciseTimer({
  nodeId,
  minutes,
  label,
}: {
  nodeId: string;
  minutes: number;
  label?: string | undefined;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(timer);
  }, []);
  const state = readTimer(nodeId, minutes, Date.now());
  const refresh = () => tick((n) => n + 1);

  return (
    <motion.aside
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={cn(
        "panel fixed top-[72px] right-4 z-40 flex items-center gap-4 px-5 py-3 backdrop-blur-md",
        state.done && "border-[color:var(--amber)]",
      )}
      aria-label="Exercise timer"
      data-testid="exercise-timer"
      data-state={
        state.done
          ? "done"
          : state.running
            ? "running"
            : state.started
              ? "paused"
              : "ready"
      }
    >
      <div>
        <div className="mono text-[10px] tracking-[0.16em] text-ink-faint uppercase">
          {state.done
            ? "time is up"
            : state.running
              ? (label ?? "your turn")
              : state.started
                ? "paused"
                : `${label ?? "your turn"} · ${minutes} min`}
        </div>
        <div
          className={cn(
            "mono text-[44px] leading-none tabular-nums",
            state.done
              ? "text-amber"
              : state.running
                ? "text-ok"
                : "text-ink-dim",
            state.done && "animate-pulse",
          )}
        >
          {formatRemaining(state.remainingMs)}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          className="choice-btn !px-2 !py-1"
          title={state.running ? "Pause (T)" : "Start (T)"}
          aria-label={state.running ? "Pause" : "Start"}
          onClick={() => {
            toggleTimer(nodeId, minutes, Date.now());
            refresh();
          }}
        >
          {state.running ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          className="choice-btn !px-2 !py-1"
          title="Reset (R)"
          aria-label="Reset"
          onClick={() => {
            resetTimer(nodeId);
            refresh();
          }}
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
    </motion.aside>
  );
}
