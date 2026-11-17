import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { Choice } from "@/deck/types";

export function Chooser({
  choices,
  visited,
  allVisited,
  continueLabel,
  onChoose,
  onContinue,
  onHover,
}: {
  choices: Choice[];
  visited: string[];
  allVisited: boolean;
  continueLabel?: string | undefined;
  onChoose: (key: string) => void;
  onContinue: () => void;
  onHover: (key: string | null) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ delay: 0.35, duration: 0.3 }}
      className="chooser"
      role="group"
      aria-label="Choose a path"
    >
      <div className="mono mb-2 text-center text-[10px] tracking-[0.18em] text-ink-faint uppercase">choose a path</div>
      <div className="flex flex-wrap justify-center gap-2">
        {allVisited && continueLabel && (
          <button type="button" className="choice-btn choice-btn--primary" onClick={onContinue}>
            <span className="mono">→ Continue to {continueLabel}</span>
          </button>
        )}
        {choices.map((c, i) => {
          const done = visited.includes(c.key);
          return (
            <button
              key={c.key}
              type="button"
              className={cn("choice-btn", done && "choice-btn--visited")}
              onClick={() => onChoose(c.key)}
              onMouseEnter={() => onHover(c.key)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(c.key)}
              onBlur={() => onHover(null)}
            >
              <span className="mono">
                {done ? <span className="text-ok">✓</span> : i + 1} · {c.label}
              </span>
              {c.hint && <span className="block text-[11px] text-ink-faint">{c.hint}</span>}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
