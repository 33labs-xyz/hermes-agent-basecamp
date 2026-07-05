const test = require('node:test')
const assert = require('node:assert/strict')

const { fetchProviderBalance, ADAPTERS, parseOpenRouterCreditsRemaining, createProviderBalanceResolver } = require('./provider-balances.cjs')

const SECRET = 'sk-or-v1-secrettoken'

function okResponse(json) {
  return { ok: true, json: async () => json }
}

test('unknown slug returns unsupported without revealing a key', async () => {
  let revealed = false
  const result = await fetchProviderBalance('nope', {
    revealKey: async () => {
      revealed = true
      return SECRET
    },
    fetchImpl: async () => okResponse({})
  })
  assert.deepEqual(result, { balance: null, status: 'unsupported' })
  assert.equal(revealed, false)
})

test('openrouter builds a Bearer request to /api/v1/credits and parses total_credits - total_usage', async () => {
  let calledUrl = null
  let calledInit = null
  const result = await fetchProviderBalance('openrouter', {
    revealKey: async envKey => {
      assert.equal(envKey, 'OPENROUTER_API_KEY')
      return SECRET
    },
    fetchImpl: async (url, init) => {
      calledUrl = url
      calledInit = init
      return okResponse({ data: { total_credits: 100, total_usage: 25.5 } })
    }
  })
  assert.equal(calledUrl, 'https://openrouter.ai/api/v1/credits')
  assert.equal(calledInit.headers.Authorization, `Bearer ${SECRET}`)
  assert.deepEqual(result, { balance: 74.5, status: 'ok' })
})

test('missing key returns unavailable and never calls fetch', async () => {
  let fetched = false
  const result = await fetchProviderBalance('openrouter', {
    revealKey: async () => null,
    fetchImpl: async () => {
      fetched = true
      return okResponse({})
    }
  })
  assert.deepEqual(result, { balance: null, status: 'unavailable' })
  assert.equal(fetched, false)
})

test('a non-OK fetch returns unavailable', async () => {
  const result = await fetchProviderBalance('openrouter', {
    revealKey: async () => SECRET,
    fetchImpl: async () => ({ ok: false, json: async () => ({}) })
  })
  assert.deepEqual(result, { balance: null, status: 'unavailable' })
})

test('a credits payload missing either field returns unavailable', async () => {
  const result = await fetchProviderBalance('openrouter', {
    revealKey: async () => SECRET,
    fetchImpl: async () => okResponse({ data: { total_credits: 100 } })
  })
  assert.deepEqual(result, { balance: null, status: 'unavailable' })
})

test('the returned object never contains the key value', async () => {
  const result = await fetchProviderBalance('openrouter', {
    revealKey: async () => SECRET,
    fetchImpl: async () => okResponse({ data: { total_credits: 10, total_usage: 0 } })
  })
  assert.equal(JSON.stringify(result).includes(SECRET), false)
})

test('parseOpenRouterCreditsRemaining returns total_credits - total_usage or null', () => {
  assert.equal(parseOpenRouterCreditsRemaining({ data: { total_credits: 100, total_usage: 25 } }), 75)
  assert.equal(parseOpenRouterCreditsRemaining({ data: { total_credits: 10, total_usage: 10 } }), 0)
  assert.equal(parseOpenRouterCreditsRemaining({ data: { total_credits: 5 } }), null)
  assert.equal(parseOpenRouterCreditsRemaining({ data: { total_credits: Infinity, total_usage: 0 } }), null)
  assert.equal(parseOpenRouterCreditsRemaining({}), null)
  assert.equal(parseOpenRouterCreditsRemaining(null), null)
})

test('ADAPTERS exposes the openrouter entry with the account-credits endpoint', () => {
  assert.equal(ADAPTERS.openrouter.envKey, 'OPENROUTER_API_KEY')
  assert.equal(ADAPTERS.openrouter.endpoint, 'https://openrouter.ai/api/v1/credits')
})

// --- createProviderBalanceResolver (Task 3 IPC seam) ---

const resolverOkJson = body => ({ ok: true, status: 200, json: async () => body })

test('createProviderBalanceResolver reveals the env key and returns the balance', async () => {
  let revealPath = null
  let revealBody = null
  const resolve = createProviderBalanceResolver({
    requestJsonForProfile: async (_profile, path, _method, body) => {
      revealPath = path
      revealBody = body

      return { value: 'sk-secret' }
    },
    fetchImpl: async () => resolverOkJson({ data: { total_credits: 20, total_usage: 8 } })
  })

  const result = await resolve('openrouter')

  assert.strictEqual(revealPath, '/api/env/reveal')
  assert.deepStrictEqual(revealBody, { key: 'OPENROUTER_API_KEY' })
  assert.deepStrictEqual(result, { balance: 12, status: 'ok' })
})

test('createProviderBalanceResolver returns unavailable when no key is revealed', async () => {
  const resolve = createProviderBalanceResolver({
    requestJsonForProfile: async () => ({}),
    fetchImpl: async () => resolverOkJson({ data: { total_credits: 20, total_usage: 8 } })
  })

  assert.deepStrictEqual(await resolve('openrouter'), { balance: null, status: 'unavailable' })
})

test('createProviderBalanceResolver returns unsupported for an unknown slug without revealing', async () => {
  let revealed = false
  const resolve = createProviderBalanceResolver({
    requestJsonForProfile: async () => {
      revealed = true

      return { value: 'sk-secret' }
    },
    fetchImpl: async () => resolverOkJson({})
  })

  assert.deepStrictEqual(await resolve('nope'), { balance: null, status: 'unsupported' })
  assert.strictEqual(revealed, false)
})
