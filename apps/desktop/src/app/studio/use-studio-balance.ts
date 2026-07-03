import { useEffect, useState } from 'react'

// Direct module import (not the ./vendor barrel) so titlebar consumers don't
// pull every vendored studio JSX file into their bundle.
import { getUserBalance } from './vendor/muapi.js'

// Remaining Muapi credit balance for a key, or null while loading / on any
// failure (missing key, expired key, network). Bump `refreshSignal` to force
// a refetch (e.g. after a generation spends credits). Routed through the
// main-process proxy, so no CORS concerns.
export function useStudioBalance(apiKey: string | null, refreshSignal: number): number | null {
  const [balance, setBalance] = useState<number | null>(null)

  useEffect(() => {
    if (!apiKey) {
      setBalance(null)

      return
    }

    let cancelled = false

    void getUserBalance(apiKey)
      .then(result => {
        if (cancelled) {return}
        const value = result?.balance
        setBalance(typeof value === 'number' && Number.isFinite(value) ? value : null)
      })
      .catch(() => {
        if (!cancelled) {setBalance(null)}
      })

    return () => {
      cancelled = true
    }
  }, [apiKey, refreshSignal])

  return balance
}

// Muapi credit balances can carry decimals; group thousands and cap at two
// places so 42.5 stays "42.5" and 1234 reads "1,234".
export function formatCredits(balance: number): string {
  return balance.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
