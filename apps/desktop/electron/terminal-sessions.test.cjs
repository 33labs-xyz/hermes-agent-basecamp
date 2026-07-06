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

test('buildSessionList groups by project and extracts titles', () => {
  const projectsDir = mkTmp()
  const cwd = path.join(mkTmp(), 'my repo') // space in path exercises the slug
  const slug = mod.slugForCwd(cwd)
  const dir = path.join(projectsDir, slug)
  fs.mkdirSync(dir, { recursive: true })
  const id = '11111111-1111-4111-8111-111111111111'
  const tx = [
    JSON.stringify({ type: 'user', cwd, gitBranch: 'main', message: { role: 'user', content: 'Fix the login bug please' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'On it.' } })
  ].join('\n')
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), tx)

  const launchesText = JSON.stringify({ id, cwd, gitRoot: cwd, ts: 1720000000, kind: 'launch' }) + '\n'
  const { projects, sessions } = mod.buildSessionList({ launchesText, claudeProjectsDir: projectsDir })

  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].title, 'Fix the login bug please')
  assert.equal(sessions[0].messageCount, 2)
  assert.equal(sessions[0].transcriptAvailable, true)
  assert.equal(sessions[0].startedAt, 1720000000)
  assert.equal(projects.length, 1)
  assert.equal(projects[0].name, 'my repo')
  assert.equal(projects[0].sessionCount, 1)
})

test('buildSessionList marks missing transcripts unavailable but keeps the row', () => {
  const projectsDir = mkTmp()
  const cwd = '/tmp/ghost'
  const id = '22222222-2222-4222-8222-222222222222'
  const launchesText = JSON.stringify({ id, cwd, gitRoot: cwd, ts: 1, kind: 'launch' }) + '\n'
  const { sessions } = mod.buildSessionList({ launchesText, claudeProjectsDir: projectsDir })
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].transcriptAvailable, false)
})

// ---- listTranscripts (Fix B: populate the panel directly from ~/.claude/projects transcripts) ----

test('listTranscripts returns all <id>.jsonl transcripts with sessionId + mtimeMs', () => {
  const projectsDir = mkTmp()
  const dirA = path.join(projectsDir, 'proj-a')
  const dirB = path.join(projectsDir, 'proj-b')
  fs.mkdirSync(dirA, { recursive: true })
  fs.mkdirSync(dirB, { recursive: true })
  const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  fs.writeFileSync(path.join(dirA, `${idA}.jsonl`), '{}')
  fs.writeFileSync(path.join(dirB, `${idB}.jsonl`), '{}')
  // non-.jsonl / non-session bookkeeping files must be ignored
  fs.writeFileSync(path.join(dirA, 'notes.txt'), 'ignore me')
  fs.writeFileSync(path.join(dirB, '.DS_Store'), '')

  const entries = mod.listTranscripts({
    claudeProjectsDir: projectsDir,
    readdirFn: fs.readdirSync,
    statFn: fs.statSync
  })

  assert.equal(entries.length, 2)
  const ids = entries.map(e => e.sessionId).sort()
  assert.deepEqual(ids, [idA, idB])
  for (const entry of entries) {
    assert.equal(typeof entry.mtimeMs, 'number')
    assert.ok(entry.transcriptPath.endsWith(`${entry.sessionId}.jsonl`))
  }
})

test('listTranscripts works with an injected in-memory readdir/stat (no bare fs)', () => {
  const claudeProjectsDir = '/fake/.claude/projects'
  const slug = '-fake-repo'
  const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const dirEntries = {
    [claudeProjectsDir]: [{ name: slug, isDirectory: () => true }],
    [path.join(claudeProjectsDir, slug)]: [
      { name: `${id}.jsonl`, isDirectory: () => false },
      { name: 'launches.jsonl', isDirectory: () => false } // bookkeeping file elsewhere, not a session id here but still not a dir
    ]
  }
  const readdirFn = dir => dirEntries[dir] || []
  const statFn = () => ({ mtimeMs: 42 })

  const entries = mod.listTranscripts({ claudeProjectsDir, readdirFn, statFn })

  assert.equal(entries.length, 2)
  const ids = entries.map(e => e.sessionId).sort()
  assert.deepEqual(ids, ['launches', id].sort())
  assert.equal(entries[0].mtimeMs, 42)
})

// ---- buildSessionList union with transcripts (the core Fix B bug) ----

test('buildSessionList surfaces a session for a transcript with NO launch record', () => {
  const projectsDir = mkTmp()
  const cwd = path.join(mkTmp(), 'orphan-repo')
  const dir = path.join(projectsDir, mod.slugForCwd(cwd))
  fs.mkdirSync(dir, { recursive: true })
  const id = '44444444-4444-4444-8444-444444444444'
  fs.writeFileSync(
    path.join(dir, `${id}.jsonl`),
    [
      JSON.stringify({ type: 'user', cwd, gitBranch: 'main', message: { role: 'user', content: 'Untracked session' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'ack' } })
    ].join('\n')
  )

  // No launches at all - this used to return [] (the bug).
  const { sessions } = mod.buildSessionList({
    launchesText: '',
    claudeProjectsDir: projectsDir,
    readdirFn: fs.readdirSync
  })

  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].id, id)
  assert.equal(sessions[0].title, 'Untracked session')
  assert.equal(sessions[0].cwd, cwd)
  assert.equal(sessions[0].gitBranch, 'main')
  assert.equal(sessions[0].messageCount, 2)
  assert.equal(sessions[0].transcriptAvailable, true)
})

test('buildSessionList dedupes an id present in both launches and transcripts, keeping launch-derived gitRoot', () => {
  const projectsDir = mkTmp()
  const cwd = path.join(mkTmp(), 'dup-repo')
  const dir = path.join(projectsDir, mod.slugForCwd(cwd))
  fs.mkdirSync(dir, { recursive: true })
  const id = '55555555-5555-4555-8555-555555555555'
  fs.writeFileSync(
    path.join(dir, `${id}.jsonl`),
    JSON.stringify({ type: 'user', cwd, gitBranch: 'main', message: { role: 'user', content: 'Dup session' } })
  )
  const gitRoot = '/some/enclosing/git/root'
  const launchesText = JSON.stringify({ id, cwd, gitRoot, ts: 123, kind: 'launch' }) + '\n'

  const { sessions } = mod.buildSessionList({ launchesText, claudeProjectsDir: projectsDir, readdirFn: fs.readdirSync })

  const matches = sessions.filter(s => s.id === id)
  assert.equal(matches.length, 1, 'must appear exactly once')
  assert.equal(matches[0].projectPath, gitRoot, 'launch-derived gitRoot/provenance wins')
})

test('buildSessionList caps transcript-only sessions at MAX_TRANSCRIPT_SESSIONS, keeping most-recent by mtime', async () => {
  const projectsDir = mkTmp()
  const dir = path.join(projectsDir, 'many-sessions')
  fs.mkdirSync(dir, { recursive: true })

  const total = mod.MAX_TRANSCRIPT_SESSIONS + 1
  const ids = []
  for (let i = 0; i < total; i++) {
    const id = `66666666-6666-4666-8666-${String(i).padStart(12, '0')}`
    ids.push(id)
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), JSON.stringify({ type: 'user', message: { role: 'user', content: `msg ${i}` } }))
    // Force distinct, increasing mtimes so ordering is deterministic: id[0] oldest, id[total-1] newest.
    const when = new Date(Date.now() + i * 1000)
    fs.utimesSync(path.join(dir, `${id}.jsonl`), when, when)
  }

  const { sessions } = mod.buildSessionList({ launchesText: '', claudeProjectsDir: projectsDir, readdirFn: fs.readdirSync })

  assert.equal(sessions.length, mod.MAX_TRANSCRIPT_SESSIONS)
  const keptIds = new Set(sessions.map(s => s.id))
  assert.ok(!keptIds.has(ids[0]), 'oldest transcript must be dropped')
  assert.ok(keptIds.has(ids[total - 1]), 'newest transcript must be kept')
  for (const s of sessions) {
    assert.equal(typeof s.projectPath, 'string', 'projectPath must be a string, never null')
    assert.ok(s.projectPath.length > 0, 'projectPath must be non-empty even for an empty-cwd transcript')
  }
})

test('parseLaunches skips corrupt lines', () => {
  const text = ['{"id":"a","ts":1,"kind":"launch"}', 'not json', '{"id":"b","ts":2,"kind":"launch"}'].join('\n')
  const recs = mod.parseLaunches(text)
  assert.deepEqual(recs.map(r => r.id), ['a', 'b'])
})

test('parseTranscriptTurns keeps user/assistant and skips tool + corrupt', () => {
  const text = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
    'garbage',
    JSON.stringify({ type: 'attachment', message: {} }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hi there' } })
  ].join('\n')
  const turns = mod.parseTranscriptTurns(text)
  assert.deepEqual(turns.map(t => t.role), ['user', 'assistant'])
  assert.equal(turns[0].text, 'hello')
})

function fakeIpc() {
  const handlers = new Map()
  return { ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, invoke: (ch, ...a) => handlers.get(ch)(null, ...a) }
}

test('list + getTranscript + forget IPC work end to end', async () => {
  const userData = mkTmp()
  const home = mkTmp()
  const projectsDir = path.join(home, '.claude', 'projects')
  const cwd = path.join(mkTmp(), 'proj')
  const dir = path.join(projectsDir, mod.slugForCwd(cwd))
  fs.mkdirSync(dir, { recursive: true })
  const id = '33333333-3333-4333-8333-333333333333'
  fs.writeFileSync(
    path.join(dir, `${id}.jsonl`),
    [
      JSON.stringify({ type: 'user', cwd, message: { role: 'user', content: 'hello world' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hi' } })
    ].join('\n')
  )

  const storeDir = path.join(userData, 'terminal-sessions')
  fs.mkdirSync(storeDir, { recursive: true })
  fs.writeFileSync(path.join(storeDir, 'launches.jsonl'), JSON.stringify({ id, cwd, gitRoot: cwd, ts: 5, kind: 'launch' }) + '\n')

  const { ipcMain, invoke } = fakeIpc()
  const app = { getPath: name => (name === 'userData' ? userData : home) }
  mod.registerTerminalSessionsIpc({ ipcMain, app, watch: false })

  const list = await invoke('terminalSessions:list')
  assert.equal(list.sessions.length, 1)
  assert.equal(list.sessions[0].title, 'hello world')

  const turns = await invoke('terminalSessions:getTranscript', id)
  assert.deepEqual(turns.map(t => t.role), ['user', 'assistant'])

  const forgot = await invoke('terminalSessions:forget', id, { deleteTranscript: true })
  assert.equal(forgot, true)
  assert.equal(fs.existsSync(path.join(dir, `${id}.jsonl`)), false)
  const after = await invoke('terminalSessions:list')
  assert.equal(after.sessions.length, 0)
})

// ---- transcriptPathToForget (Fix B forget-no-op fix: transcript-only sessions have no launch record) ----

test('transcriptPathToForget resolves by id via injected findTranscriptFn when record is undefined (transcript-only session)', () => {
  const calls = []
  const findTranscriptFn = (claudeProjectsDir, target, cwd) => {
    calls.push({ claudeProjectsDir, target, cwd })
    return '/fake/.claude/projects/proj/target-id.jsonl'
  }
  const result = mod.transcriptPathToForget({
    target: 'target-id',
    deleteTranscript: true,
    record: undefined,
    claudeProjectsDir: '/fake/.claude/projects',
    findTranscriptFn
  })
  assert.equal(result, '/fake/.claude/projects/proj/target-id.jsonl')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].target, 'target-id')
  assert.equal(calls[0].cwd, undefined)
})

test('transcriptPathToForget returns null when deleteTranscript is false', () => {
  const findTranscriptFn = () => '/should/not/be/used.jsonl'
  const result = mod.transcriptPathToForget({
    target: 'target-id',
    deleteTranscript: false,
    record: undefined,
    claudeProjectsDir: '/fake/.claude/projects',
    findTranscriptFn
  })
  assert.equal(result, null)
})

test('recordFork appends a kind:fork launch record', async () => {
  const userData = mkTmp()
  const home = mkTmp()
  const storeDir = path.join(userData, 'terminal-sessions')
  fs.mkdirSync(storeDir, { recursive: true })
  const { ipcMain, invoke } = fakeIpc()
  const app = { getPath: name => (name === 'userData' ? userData : home) }
  mod.registerTerminalSessionsIpc({ ipcMain, app, watch: false })

  const ok = await invoke('terminalSessions:recordFork', { newId: 'fork-9', fromId: 'src-1', projectPath: '/x/proj' })
  assert.equal(ok, true)
  const lines = fs.readFileSync(path.join(storeDir, 'launches.jsonl'), 'utf8').split('\n').filter(Boolean)
  const rec = JSON.parse(lines[lines.length - 1])
  assert.equal(rec.id, 'fork-9')
  assert.equal(rec.kind, 'fork')
  assert.equal(rec.cwd, '/x/proj')
})
