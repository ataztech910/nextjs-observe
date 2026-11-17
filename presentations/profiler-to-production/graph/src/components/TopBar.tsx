import { useEffect, useState } from "react";

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export function TopBar({
  title,
  subtitle,
  step,
  total,
  gamepad,
}: {
  title: string;
  subtitle?: string | undefined;
  step: number;
  total: number;
  /** Shown only while a controller is connected, so the room never sees it. */
  gamepad?: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <header className="bar bar-top">
      <div className="flex min-w-0 items-center gap-6">
        <span className="mono text-[14px] font-semibold text-ink">
          <span className="text-ok">▸</span> {title}
        </span>
        {subtitle && <span className="mono hidden truncate text-[13px] text-ink-faint md:inline">{subtitle}</span>}
      </div>
      <div className="flex items-center gap-7">
        {gamepad && (
          <span className="mono text-[13px] text-ink-faint" title="Xbox controller connected">
            🎮
          </span>
        )}
        <Metric label="Step" value={`${step} / ${total}`} />
        <Metric label="Elapsed" value={fmt(elapsed)} />
        <span className="live-pill">✓ LIVE</span>
      </div>
    </header>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right leading-none">
      <div className="mono text-[10px] tracking-[0.14em] text-ink-faint uppercase">{label}</div>
      <div className="mono mt-1 text-[15px] text-ink">{value}</div>
    </div>
  );
}
