const test = require('node:test')
const assert = require('node:assert/strict')

const { fetchProviderBalance, ADAPTERS, parseOpenRouterKeyRemaining } = require('./provider-balances.cjs')

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

test('openrouter builds a Bearer request to /api/v1/key and parses limit_remaining', async () => {
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
      return okResponse({ data: { limit_remaining: 74.5 } })
    }
  })
  assert.equal(calledUrl, 'https://openrouter.ai/api/v1/key')
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

test('null limit_remaining (unlimited key) returns unavailable', async () => {
  const result = await fetchProviderBalance('openrouter', {
    revealKey: async () => SECRET,
    fetchImpl: async () => okResponse({ data: { limit_remaining: null } })
  })
  assert.deepEqual(result, { balance: null, status: 'unavailable' })
})

test('the returned object never contains the key value', async () => {
  const result = await fetchProviderBalance('openrouter', {
    revealKey: async () => SECRET,
    fetchImpl: async () => okResponse({ data: { limit_remaining: 10 } })
  })
  assert.equal(JSON.stringify(result).includes(SECRET), false)
})

test('parseOpenRouterKeyRemaining returns null on non-finite or missing', () => {
  assert.equal(parseOpenRouterKeyRemaining({ data: { limit_remaining: 5 } }), 5)
  assert.equal(parseOpenRouterKeyRemaining({ data: { limit_remaining: Infinity } }), null)
  assert.equal(parseOpenRouterKeyRemaining({}), null)
  assert.equal(parseOpenRouterKeyRemaining(null), null)
})

test('ADAPTERS exposes the openrouter entry with the inference-key endpoint', () => {
  assert.equal(ADAPTERS.openrouter.envKey, 'OPENROUTER_API_KEY')
  assert.equal(ADAPTERS.openrouter.endpoint, 'https://openrouter.ai/api/v1/key')
})
