export const WINDOWS = { '5m': 5 * 60_000, '15m': 15 * 60_000, '1h': 60 * 60_000, '24h': 24 * 60 * 60_000 } as const
export type WindowKey = keyof typeof WINDOWS
export const DEFAULT_WINDOW: WindowKey = '15m'

export const parseWindow = (value: unknown): WindowKey | undefined => (typeof value === 'string' && value in WINDOWS ? (value as WindowKey) : undefined)

/** The time window of a page. `onChange` gets undefined for the default, so it stays out of the URL. */
export function WindowPicker({ value, onChange }: { value: WindowKey; onChange: (key: WindowKey | undefined) => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Time window">
      {(Object.keys(WINDOWS) as WindowKey[]).map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={key === value}
          onClick={() => onChange(key === DEFAULT_WINDOW ? undefined : key)}
          className="border-l px-3 py-1 font-mono text-xs text-muted-foreground uppercase first:border-l-0 hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
        >
          {key}
        </button>
      ))}
    </div>
  )
}
