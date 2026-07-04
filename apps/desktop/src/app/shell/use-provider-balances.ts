import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { providerGroup } from '@/app/settings/helpers'
import { getEnvVars } from '@/hermes'
import { sortBalanceRows, type BalanceRow, type BalanceStatus } from '@/lib/provider-balances'
import { envKeyToSlug } from '@/lib/provider-credentials'
import { $studioBalanceVersion } from '@/store/studio-balance'
import { $studioKey } from '@/store/studio-key'
import type { EnvVarInfo } from '@/types/hermes'

import { useStudioBalance } from '../studio/use-studio-balance'

export interface ConfiguredProvider {
  slug: string
  label: string
}

// Fold the saved env catalog into one entry per LLM provider the user set up in
// Basecamp, mirroring buildProviderKeyGroups: provider-category, is_set, a known
// group name (not "Other"), deduped by slug (first occurrence wins the label).
export function assembleConfiguredProviders(env: Record<string, EnvVarInfo> | undefined): ConfiguredProvider[] {
  if (!env) {
    return []
  }

  const seen = new Set<string>()
  const out: ConfiguredProvider[] = []

  for (const [envKey, info] of Object.entries(env)) {
    if (!info || info.is_set !== true || info.category !== 'provider') {
      continue
    }

    const label = providerGroup(envKey)

    if (label === 'Other') {
      continue
    }

    const slug = envKeyToSlug(envKey)

    if (seen.has(slug)) {
      continue
    }

    seen.add(slug)
    out.push({ slug, label })
  }

  return out
}

// Build the sorted balance rows for the titlebar chip: one row per configured
// LLM provider (balance fetched in the main process) plus the renderer-side
// Muapi row. `refreshSignal` bumps a manual refetch when the caller needs one.
export function useProviderBalances(refreshSignal = 0): BalanceRow[] {
  const envQuery = useQuery({ queryFn: getEnvVars, queryKey: ['env-vars'] })
  const studioKey = useStore($studioKey)
  const studioVersion = useStore($studioBalanceVersion)
  const muapiBalance = useStudioBalance(studioKey || null, studioVersion + refreshSignal)
  const configured = useMemo(() => assembleConfiguredProviders(envQuery.data), [envQuery.data])
  const slugKey = configured.map(p => p.slug).join(',')
  const [fetched, setFetched] = useState<Record<string, { balance: number | null; status: BalanceStatus }>>({})

  useEffect(() => {
    let cancelled = false
    const bridge = window.hermesDesktop?.providerBalance

    if (!bridge) {
      return
    }

    void (async () => {
      const entries = await Promise.all(
        configured.map(async provider => {
          try {
            const result = await bridge(provider.slug)

            return [provider.slug, result] as const
          } catch {
            return [provider.slug, { balance: null, status: 'unavailable' as BalanceStatus }] as const
          }
        })
      )

      if (!cancelled) {
        setFetched(Object.fromEntries(entries))
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugKey, refreshSignal])

  return useMemo(() => {
    const providerRows: BalanceRow[] = configured.map(provider => {
      const result = fetched[provider.slug]

      return {
        slug: provider.slug,
        label: provider.label,
        status: result?.status ?? 'unavailable',
        balance: result?.balance ?? null
      }
    })
    const muapiRow: BalanceRow = {
      slug: 'muapi',
      label: 'Muapi',
      status: muapiBalance == null ? 'unavailable' : 'ok',
      balance: muapiBalance
    }

    return sortBalanceRows([...providerRows, muapiRow])
  }, [configured, fetched, muapiBalance])
}
