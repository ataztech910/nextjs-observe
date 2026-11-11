/** Preserve a real zero; missing measurements remain explicitly unavailable. */
export function performanceNumber(value: number | null | undefined): string { return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(3) }
