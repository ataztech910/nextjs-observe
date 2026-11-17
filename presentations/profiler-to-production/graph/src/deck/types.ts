export type Status = "idle" | "running" | "ok" | "warn" | "error";

export type Chip = { label: string; mono?: boolean };
export type Badge = { label: string; tone: "green" | "amber" | "gray" | "red" };

/** A photo in a `detail.images` row, with a mono caption underneath. */
export type DeckImage = { src: string; caption?: string };

/** Extra visual treatment for a card. `glyphs` = matrix glyph rain, `glitch` = chromatic title. */
export type NodeEffect = "glyphs" | "glitch";

export type DeckNode = {
  id: string;
  title: string;
  subtitle?: string;
  chips?: Chip[];
  badge?: Badge;
  flag?: number;
  status?: Status;
  size?: "sm" | "md" | "lg" | "hero" | "wide" | "photo";
  effect?: NodeEffect;
  /**
   * A countdown shown while this card is in focus — for cards where the room works on its own (and for breaks).
   * `T` starts and pauses it, `R` resets.
   */
  timer?: { minutes: number; label?: string };
  /** Photo rendered inside the card itself, above the title. */
  photo?: string;
  /** Expanded with a photo: the text column's width for this card (default PHOTO_CARD.text) — wider text, narrower photo. */
  textWidth?: number;
  x: number;
  y: number;
  detail?: {
    heading?: string;
    bullets?: string[];
    code?: { lang: string; text: string };
    image?: string;
    /** Photo row, rendered side by side. Use for the team slide. */
    images?: DeckImage[];
    /**
     * QR code with a caption. Prefer `src` (a ready-made QR image in public/) —
     * use `value` only to generate one from a URL.
     */
    qr?: {
      src?: string;
      value?: string;
      caption?: string;
      /** Set when `src` is already a dark-plate QR — skips the white frame. */
      dark?: boolean;
    };
    note?: string;
  };
};

export type DeckEdge = {
  from: string;
  to: string;
  kind?: "solid" | "dashed";
  label?: string;
  /** Nudge the label off the midpoint when it would collide with a card. */
  labelDx?: number;
  labelDy?: number;
};

export type Choice = {
  key: string;
  label: string;
  hint?: string;
  goToStep: string;
};

export type Step = {
  id: string;
  focus: string[];
  /** The part of the workshop this step belongs to — shown in the bottom bar instead of "Workshop". */
  part?: string;
  zoom?: number;
  caption?: string;
  choices?: Choice[];
  returnToStep?: string;
  revealEdges?: boolean;
  /** Override the next step. `null` = end of deck. Default: next step in the array. */
  next?: string | null;
  /**
   * Hands the room over to something outside the deck — the live app.
   *
   * Advancing asks first, because it cannot be undone: the deck is replaced,
   * and `←` will not bring it back. A stray key press during a talk should not
   * be able to do that.
   */
  handOff?: {
    url: string;
    /** On the confirm button, e.g. "Open the app". */
    label: string;
    /** One line of why, under the button. */
    hint?: string;
  };
};

export type Deck = {
  meta: { title: string; subtitle?: string; badges?: Chip[] };
  nodes: DeckNode[];
  edges: DeckEdge[];
  steps: Step[];
};

export const NODE_WIDTH: Record<NonNullable<DeckNode["size"]>, number> = {
  sm: 360,
  md: 520,
  lg: 640,
  hero: 780,
  wide: 900,
  photo: 420,
};
export const EXPANDED_WIDTH = 920;
/** Expanded width for cards with a photo row — three 16:9 frames need the room. */
export const EXPANDED_WIDTH_IMAGES = 1340;
/**
 * A focused card with a `photo`: the picture on the left, the text on the right, filling the screen.
 * The camera fits it to `fill` of the viewport (w = 0.72 leaves the next card visible on the right); the card is `height` tall (more if the text needs it) and as wide as
 * that screen shape allows, within `minW`…`maxW`. The text column has a fixed width; the picture takes the rest and is
 * cropped to it (object-fit: cover) rather than shrinking the card.
 */
export const PHOTO_CARD = { height: 760, text: 360, minW: 1100, maxW: 1800, fill: { h: 0.86, w: 0.90 } };
/** Five rows, up to thirteen columns: one row per part of the workshop. */
export const WORLD = { w: 13200, h: 6900 };
