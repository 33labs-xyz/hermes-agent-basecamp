const assert = require('node:assert/strict')
const test = require('node:test')

const { isBackendStale } = require('./backend-staleness.cjs')

// A full 40-char SHA and a different one, plus a matching pair, mirror the real
// marker/stamp values (see writeBootstrapMarker / loadInstallStamp in main.cjs).
const SHA_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const SHA_B = '99887766554433221100ffeeddccbbaa99887766'

test('flags the backend stale when the shell ships a different commit than the marker', () => {
  const stale = isBackendStale({
    installStamp: { commit: SHA_A },
    marker: { pinnedCommit: SHA_B }
  })

  assert.equal(stale, true)
})

test('does not flag the backend stale when the shell commit matches the marker', () => {
  const stale = isBackendStale({
    installStamp: { commit: SHA_A },
    marker: { pinnedCommit: SHA_A }
  })

  assert.equal(stale, false)
})

test('never forces a re-sync when the install stamp is missing (dev / unpackaged)', () => {
  assert.equal(isBackendStale({ installStamp: null, marker: { pinnedCommit: SHA_B } }), false)
  assert.equal(isBackendStale({ marker: { pinnedCommit: SHA_B } }), false)
})

test('never forces a re-sync when the install stamp commit is absent or too short', () => {
  assert.equal(isBackendStale({ installStamp: {}, marker: { pinnedCommit: SHA_B } }), false)
  assert.equal(
    isBackendStale({ installStamp: { commit: 'abc123' }, marker: { pinnedCommit: SHA_B } }),
    false
  )
})

test('never forces a re-sync when the marker is missing or has no pinned commit', () => {
  assert.equal(isBackendStale({ installStamp: { commit: SHA_A }, marker: null }), false)
  assert.equal(isBackendStale({ installStamp: { commit: SHA_A } }), false)
  assert.equal(isBackendStale({ installStamp: { commit: SHA_A }, marker: {} }), false)
})

test('never forces a re-sync when the marker pinned commit is too short to trust', () => {
  assert.equal(
    isBackendStale({ installStamp: { commit: SHA_A }, marker: { pinnedCommit: 'abc12' } }),
    false
  )
})

test('tolerates being called with no arguments', () => {
  assert.equal(isBackendStale(), false)
})
