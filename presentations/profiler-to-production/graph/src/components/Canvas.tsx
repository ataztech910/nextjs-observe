import { motion, type MotionValue } from "framer-motion";
import { forwardRef, useEffect, useRef, type ReactNode } from "react";
import { WORLD } from "@/deck/types";

type Cam = { x: MotionValue<number>; y: MotionValue<number>; scale: MotionValue<number>; stop: () => void };

export const Canvas = forwardRef<
  HTMLDivElement,
  { cam: Cam; overview: boolean; onNext: () => void; onPrev: () => void; children: ReactNode }
>(function Canvas({ cam, overview, onNext, onPrev, children }, ref) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const st = useRef({ overview, onNext, onPrev, lastWheel: 0 });
  st.current.overview = overview;
  st.current.onNext = onNext;
  st.current.onPrev = onPrev;

  // Wheel: zoom/pan in overview, step in step mode
  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = st.current;
      if (s.overview) {
        cam.stop();
        const rect = el.getBoundingClientRect();
        if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
          const z = cam.scale.get();
          const next = Math.min(1.6, Math.max(0.08, z * Math.exp(-dy * 0.0018)));
          const k = next / z;
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          cam.x.set(px - (px - cam.x.get()) * k);
          cam.y.set(py - (py - cam.y.get()) * k);
          cam.scale.set(next);
        } else {
          cam.x.set(cam.x.get() - e.deltaX);
        }
        return;
      }
      const now = Date.now();
      if (now - s.lastWheel < 400 || Math.abs(e.deltaY) < 8) return;
      s.lastWheel = now;
      if (e.deltaY > 0) s.onNext();
      else s.onPrev();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [cam]);

  // Drag pan (overview) + swipe (step)
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, cx: cam.x.get(), cy: cam.y.get(), moved: false, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !overview) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 4) {
      d.moved = true;
      cam.stop();
      (e.currentTarget as HTMLElement).setPointerCapture(d.id);
    }
    if (d.moved) {
      cam.x.set(d.cx + dx);
      cam.y.set(d.cy + dy);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    (e.currentTarget as HTMLElement).dataset["dragged"] = d.moved ? "1" : "0";
    if (!overview && e.pointerType !== "mouse") {
      const dx = e.clientX - d.x;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - d.y)) {
        if (dx < 0) onNext();
        else onPrev();
      }
    }
  };
  const onClickCapture = (e: React.MouseEvent) => {
    // swallow click after a drag
    if ((e.currentTarget as HTMLElement).dataset["dragged"] === "1") e.stopPropagation();
  };

  return (
    <div
      ref={(n) => {
        localRef.current = n;
        if (typeof ref === "function") ref(n);
        else if (ref) ref.current = n;
      }}
      className="canvas-viewport"
      style={{ cursor: overview ? "grab" : "default", touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      onClickCapture={onClickCapture}
    >
      <motion.div
        id="world"
        className="world-grid absolute left-0 top-0"
        style={{
          width: WORLD.w,
          height: WORLD.h,
          x: cam.x,
          y: cam.y,
          scale: cam.scale,
          originX: 0,
          originY: 0,
          willChange: "transform",
        }}
      >
        {children}
      </motion.div>
    </div>
  );
});
