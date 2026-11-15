import { useEffect, useRef } from "react";

const GLYPHS = "01アイウエオカキクケコサシスセソタチツテトナニヌネノ{}[]()<>=+*/;:$#@&%";
const FONT = 16;
const STEP = 18;

/**
 * Matrix-style glyph rain, drawn on a canvas behind the card content.
 * Deliberately low contrast — it is texture, not a feature. Skipped when the
 * user prefers reduced motion.
 */
export function GlyphRain({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || reduced) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let drops: number[] = [];
    let w = 0;
    let h = 0;

    const resize = () => {
      const r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${FONT}px "JetBrains Mono", monospace`;
      ctx.textBaseline = "top";
      const cols = Math.ceil(w / STEP);
      drops = Array.from({ length: cols }, () => Math.random() * -h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 70) return; // ~14fps: reads as a terminal, costs nothing
      last = t;
      if (!w || !h) return;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(74, 222, 128, 0.5)";
      for (let i = 0; i < drops.length; i++) {
        const y = drops[i]!;
        const g = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;
        ctx.fillText(g, i * STEP, y);
        drops[i] = y > h + Math.random() * 400 ? -FONT : y + STEP;
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reduced]);

  if (reduced) return null;
  return <canvas ref={ref} className="glyph-rain" aria-hidden="true" />;
}
