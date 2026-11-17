import { motion } from "framer-motion";

export function PresenterNotes({ note, title }: { note?: string | undefined; title: string }) {
  return (
    <motion.aside
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      className="panel fixed bottom-[68px] left-4 z-40 w-[360px] max-h-[calc(100dvh-144px)] overflow-y-auto p-4 backdrop-blur-md"
      aria-label="Presenter notes"
    >
      <div className="mono mb-1.5 text-[10px] tracking-[0.16em] text-ink-faint uppercase">Notes · {title}</div>
      <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink-dim">{note ?? "No notes for this step."}</p>
    </motion.aside>
  );
}
