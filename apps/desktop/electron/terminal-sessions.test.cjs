'use strict'

/**
 * Terminal-sessions module: env injection, shim materialize, store build,
 * transcript parse, shim behavior.
 * Run with: node --test electron/terminal-sessions.test.cjs
 * (Wired into npm test:desktop:platforms in package.json.)
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const mod = require('./terminal-sessions.cjs')

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ts-mod-'))
}

function mkExec(dir, name) {
  fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, name)
  fs.writeFileSync(p, '#!/bin/sh\necho stub\n')
  fs.chmodSync(p, 0o755)
  return p
}

test('resolveRealClaude returns first claude that is not binDir', { skip: process.platform === 'win32' }, () => {
  const binDir = mkTmp()
  const otherDir = mkTmp()
  mkExec(binDir, 'claude') // the shim itself - must be skipped
  const real = mkExec(otherDir, 'claude')
  const pathEnv = [binDir, otherDir].join(path.delimiter)
  assert.equal(mod.resolveRealClaude(pathEnv, binDir), real)
})

test('resolveRealClaude returns empty string when only binDir has claude', { skip: process.platform === 'win32' }, () => {
  const binDir = mkTmp()
  mkExec(binDir, 'claude')
  assert.equal(mod.resolveRealClaude(binDir, binDir), '')
})

test('applyEnvWith prepends binDir and sets both vars', () => {
  const env = { PATH: '/usr/bin' + path.delimiter + '/bin' }
  const out = mod.applyEnvWith(env, { binDir: '/x/bin', storeDir: '/x/store' })
  assert.equal(out.BASECAMP_TS_DIR, '/x/store')
  assert.ok('BASECAMP_REAL_CLAUDE' in out)
  assert.ok(out.PATH.startsWith('/x/bin' + path.delimiter))
})

test('materializeShim writes an executable claude into binDir', () => {
  const binDir = path.join(mkTmp(), 'bin')
  const written = mod.materializeShim(binDir)
  assert.ok(fs.existsSync(written.claude))
  assert.ok(fs.existsSync(written.cmd))
  if (process.platform !== 'win32') {
    const mode = fs.statSync(written.claude).mode & 0o777
    assert.equal(mode & 0o100, 0o100, 'POSIX shim must be owner-executable')
  }
})
