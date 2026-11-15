import { AnimatePresence, motion } from "framer-motion";
import { Flag } from "lucide-react";
import { memo, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  EXPANDED_WIDTH,
  EXPANDED_WIDTH_IMAGES,
  PHOTO_CARD,
  NODE_WIDTH,
  type DeckNode,
} from "@/deck/types";
import { DetailPanel } from "./DetailPanel";
import { GlyphRain } from "./GlyphRain";

export type Tier = "focus" | "neighbor" | "dim" | "normal" | "candidate";

type Props = {
  node: DeckNode;
  tier: Tier;
  expanded: boolean;
  keycap?: { n: number; visited: boolean; i: number } | undefined;
  hot: boolean;
  introDelay: number;
  reduced: boolean;
  /** Viewport width ÷ height — sets the width of an expanded photo card. */
  viewAspect: number;
  onSize: (id: string, w: number, h: number) => void;
  onActivate: (id: string) => void;
};

function visual(tier: Tier, reduced: boolean) {
  switch (tier) {
    case "dim":
      return {
        opacity: 0.28,
        filter: reduced ? "blur(0px)" : "blur(1.5px)",
        scale: reduced ? 1 : 0.98,
      };
    case "neighbor":
      return { opacity: 0.55, filter: "blur(0px)", scale: 1 };
    default:
      return { opacity: 1, filter: "blur(0px)", scale: 1 };
  }
}

export const NodeCard = memo(function NodeCard({
  node,
  tier,
  expanded,
  keycap,
  hot,
  introDelay,
  reduced,
  viewAspect,
  onSize,
  onActivate,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onSize(node.id, el.offsetWidth, el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [node.id, onSize]);

  const base = NODE_WIDTH[node.size ?? "md"];
  // Expanded with a photo: picture left, text right, so a tall card does not run off a wide screen.
  const sideBySide = expanded && !!node.photo;
  // As wide as the screen shape allows at PHOTO_CARD.height, so the camera fills both directions.
  const photoWidth = Math.round(
    Math.min(
      PHOTO_CARD.maxW,
      Math.max(
        PHOTO_CARD.minW,
        (PHOTO_CARD.height * PHOTO_CARD.fill.w * viewAspect) /
          PHOTO_CARD.fill.h,
      ),
    ),
  );
  const target = sideBySide
    ? photoWidth
    : node.detail?.images
      ? EXPANDED_WIDTH_IMAGES
      : EXPANDED_WIDTH;
  const width = expanded ? Math.max(base, target) : base;
  const v = visual(tier, reduced);
  const glyphs = node.effect === "glyphs" && tier === "focus";
  const glitch = node.effect === "glitch" && tier === "focus" && !reduced;

  const header = (
    <>
      <div className="relative flex items-start gap-4">
        <span
          className={cn(
            "status-dot mt-[12px]",
            `status-${node.status ?? "idle"}`,
          )}
        />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "font-semibold text-ink",
              sideBySide
                ? "text-[40px] leading-tight"
                : node.size === "hero"
                  ? "text-[36px]"
                  : "text-[28px]",
              glitch && "glitch",
            )}
            {...(glitch ? { "data-text": node.title } : {})}
          >
            {node.title}
          </div>
          {node.subtitle && (
            <div
              className={cn(
                "mono mt-1.5 text-ink-faint",
                sideBySide ? "text-[20px]" : "text-[16px]",
              )}
            >
              {node.subtitle}
            </div>
          )}
        </div>
        {node.flag ? (
          <span className="flag-pill">
            <Flag className="h-4 w-4" fill="currentColor" />
            {node.flag}
          </span>
        ) : null}
      </div>

      {node.chips && (
        <div className="relative mt-4 flex flex-wrap items-center gap-2.5 pl-6">
          {node.chips.map((c, i) => (
            <span key={i} className={cn("chip", c.mono && "mono")}>
              {c.label}
            </span>
          ))}
        </div>
      )}
      {node.badge && (
        <div className="relative mt-4 pl-6">
          <span className={cn("badge", `badge-${node.badge.tone}`)}>
            {node.badge.label}
          </span>
        </div>
      )}
    </>
  );
  const details = (
    <div className="relative">
      <AnimatePresence initial={false}>
        {expanded && node.detail && (
          <DetailPanel
            key="d"
            detail={node.detail}
            reduced={reduced}
            large={sideBySide}
          />
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <motion.div
      className="absolute"
      style={{
        left: node.x,
        top: node.y,
        zIndex: expanded
          ? 30
          : tier === "focus" || tier === "candidate"
            ? 20
            : 10,
      }}
      initial={{ opacity: 0, y: reduced ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: introDelay, duration: 0.45 }}
    >
      <motion.div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label={`${node.title}${node.subtitle ? ` — ${node.subtitle}` : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onActivate(node.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.stopPropagation();
            onActivate(node.id);
          }
        }}
        className={cn(
          "node-card",
          sideBySide && "node-card--side",
          node.size === "hero" && "node-card--hero",
          tier === "focus" && "node-card--focus",
          tier === "candidate" && "node-card--candidate",
          hot && "node-card--hot",
          glyphs && "node-card--glyphs",
        )}
        style={{ width }}
        animate={v}
        transition={{
          duration: reduced ? 0.15 : 0.5,
          ease: [0.2, 0.7, 0.2, 1],
        }}
      >
        <AnimatePresence>
          {keycap && (
            <motion.span
              key="cap"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{
                delay: 0.5 + keycap.i * 0.08,
                type: "spring",
                stiffness: 400,
                damping: 22,
              }}
              className={cn("keycap", keycap.visited && "keycap--visited")}
            >
              {keycap.visited ? "✓" : keycap.n}
            </motion.span>
          )}
        </AnimatePresence>

        {glyphs && <GlyphRain reduced={reduced} />}

        {sideBySide ? (
          <div
            className="relative grid items-stretch gap-8"
            // The card's padding (28 px top and bottom) is outside the grid.
            style={{
              gridTemplateColumns: `minmax(0,1fr) ${node.textWidth ?? PHOTO_CARD.text}px`,
              minHeight: PHOTO_CARD.height - 56,
            }}
          >
            {/* The picture fills its column at the card's height; what does not fit the width is cropped. */}
            <div className="relative min-h-0 overflow-hidden rounded-[10px]">
              <img
                src={node.photo}
                alt=""
                className="photo-frame photo-frame--fill"
              />
            </div>
            <div className="min-w-0 self-center">
              {header}
              {details}
            </div>
          </div>
        ) : (
          <>
            {node.photo && (
              <img
                src={node.photo}
                alt=""
                className="photo-frame relative mb-5"
              />
            )}
            {header}
            {details}
          </>
        )}
      </motion.div>
    </motion.div>
  );
});
