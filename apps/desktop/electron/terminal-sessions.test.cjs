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

const { execFileSync } = require('node:child_process')

// A stub "real claude" that just prints its argv, one per line, so the test can
// assert what the shim exec'd.
function writeStubClaude(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, 'real-claude')
  fs.writeFileSync(p, '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n')
  fs.chmodSync(p, 0o755)
  return p
}

function runShim(args, { pwd, tsDir, real }) {
  const shim = mod.materializeShim(path.join(mkTmp(), 'bin')).claude
  const out = execFileSync('/bin/sh', [shim, ...args], {
    cwd: pwd,
    env: { ...process.env, BASECAMP_REAL_CLAUDE: real, BASECAMP_TS_DIR: tsDir, PATH: process.env.PATH },
    encoding: 'utf8'
  })
  return out.split('\n').filter(Boolean)
}

test('shim mints --session-id on a fresh launch and appends one record', { skip: process.platform === 'win32' }, () => {
  const work = mkTmp()
  const tsDir = mkTmp()
  const real = writeStubClaude(mkTmp())
  const argv = runShim([], { pwd: work, tsDir, real })
  assert.equal(argv[0], '--session-id')
  assert.match(argv[1], /^[0-9a-f-]{36}$/)
  const lines = fs.readFileSync(path.join(tsDir, 'launches.jsonl'), 'utf8').split('\n').filter(Boolean)
  assert.equal(lines.length, 1)
  const rec = JSON.parse(lines[0])
  assert.equal(rec.id, argv[1])
  assert.equal(rec.kind, 'launch')
  assert.equal(typeof rec.ts, 'number')
})

test('shim passes through resume/continue/mcp/version with no record', { skip: process.platform === 'win32' }, () => {
  const tsDir = mkTmp()
  const real = writeStubClaude(mkTmp())
  for (const args of [['--resume', 'abc'], ['-c'], ['mcp', 'list'], ['--version']]) {
    const argv = runShim(args, { pwd: mkTmp(), tsDir, real })
    assert.deepEqual(argv, args, `passthrough for ${args.join(' ')}`)
  }
  assert.equal(fs.existsSync(path.join(tsDir, 'launches.jsonl')), false)
})

test('shim still execs when the log dir is unwritable', { skip: process.platform === 'win32' }, () => {
  const real = writeStubClaude(mkTmp())
  const argv = runShim([], { pwd: mkTmp(), tsDir: '/proc/nonexistent-ts-dir', real })
  assert.equal(argv[0], '--session-id') // mint proceeds; append failure is swallowed
})
