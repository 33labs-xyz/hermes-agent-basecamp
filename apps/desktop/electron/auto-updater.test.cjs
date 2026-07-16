const test = require('node:test')
const assert = require('node:assert/strict')

// app.isPackaged is false under `node --test`, so initAutoUpdater no-ops and the
// pure helpers + exports are exercisable without a real Electron/electron-updater.
const mod = require('./auto-updater.cjs')

test('exports the auto-update surface', () => {
  for (const name of [
    'initAutoUpdater',
    'checkForUpdatesManual',
    'checkForUpdatesAuto',
    'triggerQuitAndInstall',
    'shouldRecheck'
  ]) {
    assert.equal(typeof mod[name], 'function', `missing export: ${name}`)
  }
})

test('shouldRecheck: first-ever check (null) is allowed', () => {
  assert.equal(mod.shouldRecheck(null, 1000, 300000), true)
})

test('shouldRecheck: inside the gap is blocked', () => {
  assert.equal(mod.shouldRecheck(1000, 1000 + 299999, 300000), false)
})

test('shouldRecheck: exactly at the gap is allowed', () => {
  assert.equal(mod.shouldRecheck(1000, 1000 + 300000, 300000), true)
})

test('shouldRecheck: past the gap is allowed', () => {
  assert.equal(mod.shouldRecheck(1000, 1000 + 600000, 300000), true)
})

test('triggerQuitAndInstall schedules quitAndInstall on the injected updater', async () => {
  let called = false
  const res = mod.triggerQuitAndInstall({ quitAndInstall: () => { called = true } })
  assert.deepEqual(res, { ok: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(called, true)
})

test('triggerQuitAndInstall reports unavailable when no updater', () => {
  const res = mod.triggerQuitAndInstall(null)
  // With no injected updater and loadUpdater() null under node:test, it is unavailable.
  assert.equal(res.ok, false)
})
