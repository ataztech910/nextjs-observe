// Just **bold** and `code` — enough for agent reports. Builds React elements, never HTML, so nothing can be injected.
import { Fragment, type ReactNode } from 'react'

export function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return (
        <code key={i} className="rounded bg-muted px-1 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      )
    return <Fragment key={i}>{part}</Fragment>
  })
}
