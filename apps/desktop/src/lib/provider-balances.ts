// Pure, immutable helpers for the titlebar provider-balance picker. No I/O here:
// the main process fetches balances and the renderer hook assembles rows. These
// helpers decide ordering, the default provider, and which provider the chip
// displays. Mirrors the pure/immutable style of featured-templates.ts.

export type BalanceStatus = 'ok' | 'unavailable' | 'unsupported'

export interface BalanceRow {
  slug: string
  label: string
  status: BalanceStatus
  balance: number | null
}

// Group rank: ok first, then unavailable, then unsupported.
const STATUS_RANK: Record<BalanceStatus, number> = {
  ok: 0,
  unavailable: 1,
  unsupported: 2
}

// Slug the chip defaults to before the user pins one. Only ever an ok provider:
// OpenRouter if ok, else MUAPI if ok, else the first ok row, else null (nothing
// has a number, so the control hides). Never mutates the input.
export function resolveDefaultProvider(rows: readonly BalanceRow[] | null | undefined): string | null {
  if (!Array.isArray(rows)) {
    return null
  }
  const isOk = (slug: string) => rows.some(r => r.slug === slug && r.status === 'ok')
  if (isOk('openrouter')) {
    return 'openrouter'
  }
  if (isOk('muapi')) {
    return 'muapi'
  }
  const firstOk = rows.find(r => r.status === 'ok')
  return firstOk ? firstOk.slug : null
}

// New array ordered by status rank, stable within a group. Never mutates input.
export function sortBalanceRows(rows: readonly BalanceRow[] | null | undefined): BalanceRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const rankDelta = STATUS_RANK[a.row.status as BalanceStatus] - STATUS_RANK[b.row.status as BalanceStatus]
      return rankDelta !== 0 ? rankDelta : a.index - b.index
    })
    .map(entry => entry.row)
}

// Which provider slug the chip shows. Studio pins MUAPI when MUAPI has a number;
// otherwise a valid pinned pick wins; otherwise the computed fallback. Guarantees
// an ok provider or null. isOk(slug) reports whether that slug's row is ok.
export function pickDisplayedProvider(args: {
  isStudio: boolean
  selected: string | null
  fallback: string | null
  isOk: (slug: string) => boolean
}): string | null {
  const { isStudio, selected, fallback, isOk } = args
  if (isStudio && isOk('muapi')) {
    return 'muapi'
  }
  if (selected && isOk(selected)) {
    return selected
  }
  return fallback
}

// Parses OpenRouter GET /api/v1/credits. Returns total_credits - total_usage (the
// account-wide dollar balance) when both fields are finite, else null (missing,
// null, or non-finite). Mirrors parseOpenRouterCreditsRemaining in
// electron/provider-balances.cjs, which is the one used for the real fetch.
export function parseOpenRouterCreditsRemaining(json: unknown): number | null {
  const data = (json as { data?: { total_credits?: unknown; total_usage?: unknown } } | null | undefined)?.data
  const total = data?.total_credits
  const used = data?.total_usage
  if (typeof total !== 'number' || !Number.isFinite(total)) return null
  if (typeof used !== 'number' || !Number.isFinite(used)) return null
  return total - used
}
