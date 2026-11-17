import { motion } from "framer-motion";

const KEYS: [string, string][] = [
  ["→ / Space / PgDn", "Next"],
  ["← / PgUp", "Back (walks history)"],
  ["1 – 9", "Pick a branch"],
  ["O", "Toggle overview"],
  ["Esc", "Overview / close"],
  ["N", "Presenter notes"],
  ["T / R", "Start or pause the exercise timer / reset it"],
  ["F", "Fullscreen"],
  ["Home", "First step"],
  ["?", "This help"],
];

const PAD: [string, string][] = [
  ["RB / A", "Next · confirms a branch"],
  ["LB / B", "Back · cancels a branch"],
  ["D-pad ← →", "Move between branches"],
  ["D-pad ↑ / ↓", "Start or pause the timer / reset it"],
  ["Y", "Toggle overview"],
  ["X", "Presenter notes"],
  ["START", "Fullscreen"],
  ["BACK", "First step"],
];

export function HelpOverlay({ onClose, gamepad }: { onClose: () => void; gamepad?: boolean }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="panel w-[420px] p-6"
        initial={{ scale: 0.96, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mono mb-4 text-[11px] tracking-[0.16em] text-ink-faint uppercase">Keyboard</div>
        <dl className="space-y-2.5">
          {KEYS.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4">
              <dt className="chip mono">{k}</dt>
              <dd className="text-[14px] text-ink-dim">{v}</dd>
            </div>
          ))}
        </dl>
        {gamepad && (
          <>
            <div className="mono mt-6 mb-4 text-[11px] tracking-[0.16em] text-ink-faint uppercase">
              Controller · connected
            </div>
            <dl className="space-y-2.5">
              {PAD.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-4">
                  <dt className="chip mono">{k}</dt>
                  <dd className="text-[14px] text-ink-dim">{v}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
        <p className="mt-5 text-[12px] text-ink-faint">Click any card to jump there. Drag & scroll to explore in overview.</p>
      </motion.div>
    </motion.div>
  );
}
