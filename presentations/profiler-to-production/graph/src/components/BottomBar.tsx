import { ChevronLeft, ChevronRight, HelpCircle, Map, Maximize, StickyNote } from "lucide-react";
import { Fragment } from "react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; branch?: boolean };

export function BottomBar({
  crumbs,
  caption,
  onPrev,
  onNext,
  onOverview,
  onHelp,
  onNotes,
  onFullscreen,
}: {
  crumbs: Crumb[];
  caption?: string | undefined;
  onPrev: () => void;
  onNext: () => void;
  onOverview: () => void;
  onHelp: () => void;
  onNotes: () => void;
  onFullscreen: () => void;
}) {
  return (
    <footer className="bar bar-bottom">
      <nav aria-label="Path" className="mono flex min-w-0 flex-1 items-center gap-2 truncate text-[12px]">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="text-ink-ghost">›</span>}
            <span className={cn(c.branch ? "text-amber" : "text-ink-faint", i === crumbs.length - 1 && !c.branch && "text-ink-dim")}>
              {c.label}
            </span>
          </Fragment>
        ))}
      </nav>
      <div className="hidden flex-1 justify-center truncate text-center text-[14px] text-ink-dim md:flex">{caption}</div>
      <div className="flex flex-1 items-center justify-end gap-1">
        <IconBtn label="Previous (←)" onClick={onPrev}>
          <ChevronLeft className="h-4 w-4" />
        </IconBtn>
        <IconBtn label="Next (→)" onClick={onNext}>
          <ChevronRight className="h-4 w-4" />
        </IconBtn>
        <span className="mx-1 h-4 w-px bg-hairline" />
        <IconBtn label="Overview (O)" onClick={onOverview}>
          <Map className="h-4 w-4" />
        </IconBtn>
        <IconBtn label="Presenter notes (N)" onClick={onNotes}>
          <StickyNote className="h-4 w-4" />
        </IconBtn>
        <IconBtn label="Fullscreen (F)" onClick={onFullscreen}>
          <Maximize className="h-4 w-4" />
        </IconBtn>
        <IconBtn label="Help (?)" onClick={onHelp}>
          <HelpCircle className="h-4 w-4" />
        </IconBtn>
      </div>
    </footer>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="icon-btn">
      {children}
    </button>
  );
}
