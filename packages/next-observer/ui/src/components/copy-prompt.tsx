import { Check, ClipboardCopy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * navigator.clipboard exists only in a secure context (https or localhost). An observer opened by IP over plain http
 * — the droplet in the workshop demo — has none, so fall back to the old textarea + copy command.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission denied or the document is not focused — try the fallback.
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}

/** "Copy prompt": puts a ready prompt for a coding agent on the clipboard. `build` runs on click, with fresh data. */
export function CopyPrompt({ build, className }: { build: () => string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={className}
      data-testid="copy-prompt"
      data-state={state}
      title="A prompt for Claude Code, Cursor or another coding agent: the measured facts and the task"
      onClick={async () => {
        setState((await copyText(build())) ? 'copied' : 'failed')
        setTimeout(() => setState('idle'), 2000)
      }}
    >
      {state === 'copied' ? <Check aria-hidden /> : <ClipboardCopy aria-hidden />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy prompt'}
    </Button>
  )
}
