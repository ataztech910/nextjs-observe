import { motion } from "framer-motion";
import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { NODE_WIDTH, WORLD, type Deck } from "@/deck/types";

type Size = { w: number; h: number };

export const EdgeLayer = memo(function EdgeLayer({
  deck,
  sizes,
  active,
  hot,
  reduced,
}: {
  deck: Deck;
  sizes: Record<string, Size>;
  active: Set<string>;
  hot: Set<string>;
  reduced: boolean;
}) {
  const paths = useMemo(() => {
    const byId = new Map(deck.nodes.map((n) => [n.id, n]));
    return deck.edges
      .map((e) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) return null;
        const sa = sizes[a.id] ?? { w: NODE_WIDTH[a.size ?? "md"], h: 140 };
        const sb = sizes[b.id] ?? { w: NODE_WIDTH[b.size ?? "md"], h: 140 };
        const x1 = a.x + sa.w;
        const y1 = a.y + sa.h / 2;
        const x2 = b.x;
        const y2 = b.y + sb.h / 2;
        const dx = Math.max(60, (x2 - x1) * 0.5);
        return {
          key: `${e.from}>${e.to}`,
          d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
          dashed: e.kind === "dashed",
          label: e.label,
          mx: (x1 + x2) / 2,
          my: (y1 + y2) / 2,
          sx: x1,
        };
      })
      .filter((p): p is NonNullable<typeof p> => !!p);
  }, [deck, sizes]);

  const order = useMemo(() => {
    const sorted = [...paths].sort((p, q) => p.sx - q.sx);
    return new Map(sorted.map((p, i) => [p.key, i]));
  }, [paths]);

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={WORLD.w}
      height={WORLD.h}
      aria-hidden
    >
      {paths.map((p) => {
        const isActive = active.has(p.key);
        const isHot = hot.has(p.key);
        const delay = 0.15 + (order.get(p.key) ?? 0) * 0.04;
        return (
          <g key={p.key}>
            {p.dashed ? (
              <motion.path
                d={p.d}
                className={cn("edge edge--dashed", isActive && "edge--active", isHot && "edge--hot")}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay, duration: 0.5 }}
              />
            ) : (
              <motion.path
                d={p.d}
                className={cn("edge", isActive && "edge--active", isHot && "edge--hot")}
                initial={{ pathLength: reduced ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={{ delay, duration: 0.6, ease: "easeOut" }}
              />
            )}
            {(isActive || isHot) && !reduced && <path d={p.d} className="edge-flow" />}
            {p.label && (
              <text x={p.mx} y={p.my - 22} className="edge-label" textAnchor="middle">
                {p.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
});
