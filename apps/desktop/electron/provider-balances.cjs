// Main-process provider balance fetcher for the titlebar credit chip.
//
// Holds a per-provider adapter registry and a single fetch entry point. The main
// process reveals the provider key (kept transient, never returned or logged),
// calls the provider's balance endpoint, and returns only a number plus a
// status. New providers slot in by adding an ADAPTERS entry. revealKey and
// fetchImpl are injected so this module is testable with node:test and no
// network. Mirrors the self-contained style of electron/studio.cjs.

// OpenRouter: GET /api/v1/key works with the configured inference key and
// returns data.limit_remaining (credits remaining on that key). The account-wide
// /api/v1/credits endpoint needs a management key the inference key is not, so it
// is not used. When the key has no per-key limit, limit_remaining is null and the
// balance reads unavailable.
function parseOpenRouterKeyRemaining(json) {
  const value = json && json.data ? json.data.limit_remaining : undefined
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const ADAPTERS = {
  openrouter: {
    envKey: 'OPENROUTER_API_KEY',
    endpoint: 'https://openrouter.ai/api/v1/key',
    buildRequest(key) {
      return { headers: { Authorization: `Bearer ${key}` } }
    },
    parse: parseOpenRouterKeyRemaining
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

module.exports = { ADAPTERS, fetchProviderBalance, parseOpenRouterKeyRemaining, createProviderBalanceResolver }
