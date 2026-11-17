import { animate, useMotionValue } from "framer-motion";
import { useCallback, useRef } from "react";

export type Box = { x: number; y: number; w: number; h: number };

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const SPRING = { type: "spring" as const, stiffness: 110, damping: 22, mass: 0.9, restDelta: 0.001 };

export function useCamera(reduced: boolean) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scale = useMotionValue(1);
  const anims = useRef<{ stop: () => void }[]>([]);

  const set = useCallback(
    (tx: number, ty: number, s: number, animated: boolean) => {
      anims.current.forEach((a) => a.stop());
      if (!animated) {
        x.set(tx);
        y.set(ty);
        scale.set(s);
        return;
      }
      const t = reduced ? { duration: 0.15 } : SPRING;
      anims.current = [animate(x, tx, t), animate(y, ty, t), animate(scale, s, t)];
    },
    [x, y, scale, reduced],
  );

  const fit = useCallback(
    (
      b: Box,
      vp: { w: number; h: number },
      o: {
        pad?: number;
        padBottom?: number;
        zoom?: number | undefined;
        factor?: number;
        minScale?: number;
        /** Fill this fraction of the viewport height with the box (single-card focus). */
        fillH?: number | undefined;
        /** Cap the box width at this fraction of the viewport width (with fillH). */
        fillW?: number | undefined;
        /** Place the box center at this fraction of the viewport width (default 0.5). */
        alignX?: number | undefined;
        /** Place the box left edge at this fraction of the viewport width (overrides alignX). */
        alignLeft?: number | undefined;
        animate: boolean;
      },
    ) => {
      const pad = o.pad ?? 120;
      const pb = o.padBottom ?? 0;
      const bw = b.w + pad * 2;
      const bh = b.h + pad * 2 + pb;
      let s =
        o.zoom ??
        (o.fillH
          ? clamp(
              Math.min((vp.h * o.fillH) / b.h, o.fillW ? (vp.w * o.fillW) / b.w : Infinity),
              o.minScale ?? 0.35,
              1.6,
            )
          : clamp(Math.min(vp.w / bw, vp.h / bh), o.minScale ?? 0.35, 1.6));
      s *= o.factor ?? 1;
      if (o.fillH) {
        // Never let a single card overflow the viewport vertically.
        const maxS = (vp.h * 0.92 - pb) / b.h;
        if (s > maxS) s = Math.max(0.2, maxS);
      }
      const cx = b.x + b.w / 2;
      const cy = o.fillH ? b.y + b.h / 2 + pb / (2 * s) : b.y + b.h / 2 + pb / 2;
      const tx =
        o.alignLeft != null ? vp.w * o.alignLeft + (b.w / 2) * s - cx * s : vp.w * (o.alignX ?? 0.5) - cx * s;
      set(tx, vp.h / 2 - cy * s, s, o.animate);
    },
    [set],
  );

  const stop = useCallback(() => anims.current.forEach((a) => a.stop()), []);

  return { x, y, scale, fit, stop };
}
