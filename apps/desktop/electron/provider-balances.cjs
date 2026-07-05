// Main-process provider balance fetcher for the titlebar credit chip.
//
// Holds a per-provider adapter registry and a single fetch entry point. The main
// process reveals the provider key (kept transient, never returned or logged),
// calls the provider's balance endpoint, and returns only a number plus a
// status. New providers slot in by adding an ADAPTERS entry. revealKey and
// fetchImpl are injected so this module is testable with node:test and no
// network. Mirrors the self-contained style of electron/studio.cjs.

// OpenRouter: GET /api/v1/credits works with the configured inference key and
// returns data.total_credits (lifetime purchased) and data.total_usage (lifetime
// spent); remaining = total_credits - total_usage, the account-wide dollar balance
// the chip shows. This is the number the user means by "credits left", unlike the
// per-key limit_remaining on /api/v1/key which is null for normal unlimited keys.
// Both fields must be finite; anything else degrades to null (reads unavailable).
function parseOpenRouterCreditsRemaining(json) {
  const data = json && json.data ? json.data : null
  const total = data ? data.total_credits : undefined
  const used = data ? data.total_usage : undefined
  if (typeof total !== 'number' || !Number.isFinite(total)) return null
  if (typeof used !== 'number' || !Number.isFinite(used)) return null
  return total - used
}

const ADAPTERS = {
  openrouter: {
    envKey: 'OPENROUTER_API_KEY',
    endpoint: 'https://openrouter.ai/api/v1/credits',
    buildRequest(key) {
      return { headers: { Authorization: `Bearer ${key}` } }
    },
    parse: parseOpenRouterCreditsRemaining
  }
}

// Fetches one provider's balance. Returns { balance, status } where status is
// 'ok' | 'unavailable' | 'unsupported'. Never throws; every failure degrades to a
// status. The revealed key is used for a single fetch and never included in the
// return value or any log line.
async function fetchProviderBalance(slug, { revealKey, fetchImpl }) {
  const adapter = ADAPTERS[slug]
  if (!adapter) {
    return { balance: null, status: 'unsupported' }
  }

  let key
  try {
    key = await revealKey(adapter.envKey)
  } catch {
    return { balance: null, status: 'unavailable' }
  }
  if (!key) {
    return { balance: null, status: 'unavailable' }
  }

  try {
    const request = adapter.buildRequest(key)
    const response = await fetchImpl(adapter.endpoint, request)
    if (!response || !response.ok) {
      return { balance: null, status: 'unavailable' }
    }
    const json = await response.json()
    const balance = adapter.parse(json)
    if (typeof balance !== 'number' || !Number.isFinite(balance)) {
      return { balance: null, status: 'unavailable' }
    }
    return { balance, status: 'ok' }
  } catch {
    return { balance: null, status: 'unavailable' }
  }
}

// Bridge fetchProviderBalance to the main process's profile-aware secret
// reveal. `requestJsonForProfile(null, ...)` targets the active profile; the
// revealed key is used transiently for one fetch and never returned to the
// renderer or logged. `fetchImpl` is injected so tests stay hermetic.
function createProviderBalanceResolver({ requestJsonForProfile, fetchImpl }) {
  const revealKey = async envKey => {
    const res = await requestJsonForProfile(null, '/api/env/reveal', 'POST', { key: envKey })

    return res && typeof res.value === 'string' ? res.value : null
  }

  return slug => fetchProviderBalance(slug, { revealKey, fetchImpl })
}

module.exports = { ADAPTERS, fetchProviderBalance, parseOpenRouterCreditsRemaining, createProviderBalanceResolver }
