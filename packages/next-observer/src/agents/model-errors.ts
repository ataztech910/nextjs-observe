// What a model provider's error means for the person in the chat: wait and it will work (rate limit, overload), or
// something has to be fixed first (no credits, a bad key, a wrong model name). Providers report these as HTTP statuses;
// Gemini through ADK throws ApiError { status, message: '<the API's JSON body>' }.

export interface ModelError {
  /** HTTP status when the provider reported one. */
  status?: number
  /** The provider's own message, without the JSON around it. */
  message: string
  /** How long the provider asked to wait, when it said so. */
  retryAfterMs?: number
}

export function parseModelError(error: unknown): ModelError {
  const raw = error instanceof Error ? error.message : String(error)
  const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : undefined
  let message = raw
  let retryAfterMs: number | undefined
  try {
    const body = JSON.parse(raw) as { error?: { message?: unknown; details?: { '@type'?: string; retryDelay?: unknown }[] } }
    if (typeof body.error?.message === 'string') message = body.error.message
    // google.rpc.RetryInfo: retryDelay as "7s" / "7.5s".
    const delay = body.error?.details?.find((d) => typeof d.retryDelay === 'string')?.retryDelay as string | undefined
    const seconds = delay === undefined ? NaN : Number.parseFloat(delay)
    if (Number.isFinite(seconds)) retryAfterMs = seconds * 1000
  } catch {
    // Not JSON: the message is already plain text.
  }
  if (retryAfterMs === undefined) {
    const inText = /retry in ([\d.]+)\s*s/i.exec(message)
    if (inText) retryAfterMs = Number.parseFloat(inText[1]) * 1000
  }
  return { ...(status !== undefined ? { status } : {}), message: message.trim(), ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) }
}

/** Too many requests, or the provider is overloaded / briefly down: the same call can succeed a little later. */
export const isTransient = (e: ModelError) => e.status === 429 || e.status === 500 || e.status === 502 || e.status === 503 || e.status === 504

/**
 * The error as the chat shows it: what happened in plain words and what to do, then the provider's own message.
 * Unknown errors pass through unchanged.
 */
export function explainModelError(e: ModelError, tried = 1): string {
  const again = tried > 1 ? ` (tried ${tried} times)` : ''
  const provider = e.message ? ` Provider: ${e.message}` : ''
  switch (e.status) {
    case 429: {
      const wait = e.retryAfterMs ? `in about ${Math.ceil(e.retryAfterMs / 1000)}s` : 'in a minute'
      return `The model's rate limit is reached${again} — ask again ${wait}. Free tiers allow only a few requests per minute, and one investigation makes several.${provider}`
    }
    case 402:
      return `The model provider refused the request: the account has no credits left. Top up the account or use another API key, then ask again.${provider}`
    case 401:
    case 403:
      return `The model provider rejected the API key — check GEMINI_API_KEY (and that the key may use this model).${provider}`
    case 400:
      return `The model provider rejected the request as invalid — this is a bug in next-observer or in a custom specialist, not something to retry.${provider}`
    case 404:
      return `The model was not found — check the model name in GEMINI_MODEL.${provider}`
    case 500:
    case 502:
    case 503:
    case 504:
      return `The model provider is overloaded or unavailable${again} — ask again in a minute.${provider}`
    default:
      return e.message
  }
}
