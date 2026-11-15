import { motion } from "framer-motion";
import { useEffect } from "react";
import type { Step } from "@/deck/types";

/**
 * The last step of the talk: leave the deck for the live app.
 *
 * It asks first, and it asks the way the controller does — A to go, B to stay —
 * because the deck is driven from an Xbox pad and the prompt should speak the
 * same language. Leaving replaces the deck and `←` does not bring it back, so a
 * stray press of Space must not be able to do it.
 */
export function HandOff({
  handOff,
  onConfirm,
  onCancel,
  gamepad,
}: {
  handOff: NonNullable<Step["handOff"]>;
  onConfirm: () => void;
  onCancel: () => void;
  /** True while a controller is connected, so the hint names the right button. */
  gamepad?: boolean;
}) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "b" || e.key === "B") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
      if (
        e.key === "Enter" ||
        e.key === " " ||
        e.key === "a" ||
        e.key === "A"
      ) {
        e.preventDefault();
        e.stopPropagation();
        onConfirm();
      }
    };
    window.addEventListener("keydown", on, { capture: true });
    return () => window.removeEventListener("keydown", on, { capture: true });
  }, [onConfirm, onCancel]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.div
        role="dialog"
        aria-label={handOff.label}
        className="panel relative w-[560px] overflow-hidden p-8 text-center"
        initial={{ scale: 0.95, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mono text-[11px] tracking-[0.18em] text-ink-faint uppercase">
          Leaving the presentation
        </div>

        <h2 className="mt-5 text-[30px] leading-tight font-semibold text-ink">
          Jacking into the <span className="text-ok">cyberdata</span>
        </h2>
        {handOff.hint && (
          <p className="mt-3 text-[17px] leading-snug text-ink-dim">
            {handOff.hint}
          </p>
        )}
        <code className="mono mt-5 block truncate text-[14px] text-ink-faint">
          {handOff.url}
        </code>

        <div className="mt-8 flex items-start justify-center gap-10">
          <PadButton
            letter="A"
            tone="ok"
            label={handOff.label}
            sub={gamepad ? "A on the pad · Enter" : "Enter"}
            onClick={onConfirm}
            autoFocus
          />
          <PadButton
            letter="B"
            tone="danger"
            label="Stay"
            sub={gamepad ? "B on the pad · Esc" : "Esc"}
            onClick={onCancel}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}

/** A round Xbox face button: green A to go on, red B to stay. */
function PadButton({
  letter,
  tone,
  label,
  sub,
  onClick,
  autoFocus,
}: {
  letter: string;
  tone: "ok" | "danger";
  label: string;
  sub: string;
  onClick: () => void;
  autoFocus?: boolean;
}) {
  const ring = tone === "ok" ? "pad-btn--ok" : "pad-btn--danger";
  return (
    <button
      onClick={onClick}
      autoFocus={autoFocus}
      className="pad-press group flex w-[150px] flex-col items-center gap-3"
    >
      <span className={`pad-btn ${ring}`}>{letter}</span>
      <span className="text-[16px] font-semibold text-ink">{label}</span>
      <span className="mono text-[11px] tracking-[0.08em] text-ink-faint uppercase">
        {sub}
      </span>
    </button>
  );
}
