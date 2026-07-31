// Regression: a bootstrap stage that blocks forever spins the UI in silence.
//
// spawnBash resolves only on the child's `close` event, so a subprocess that
// never exits (a GUI dialog waiting on a click, a curl against a black-holed
// host) leaves the desktop bootstrap on "prerequisites" with no output and no
// way out but Force Quit. Testers on macOS burned ~15 minutes per attempt that
// way. A stage that has emitted nothing for a while is stuck: kill it and say
// so, naming the log the user can actually read.

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { spawnBash, stallErrorMessage, STAGE_STALL_TIMEOUT_MS } = require('./bootstrap-runner.cjs')

const isWindows = process.platform === 'win32'

function writeScript(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-stall-'))
  const p = path.join(dir, 'fake-install.sh')
  fs.writeFileSync(p, body)
  return p
}

test('spawnBash kills a stage that stops producing output', { skip: isWindows }, async () => {
  // Prints one line, then blocks far longer than the stall window.
  const scriptPath = writeScript('#!/bin/bash\necho "starting"\nsleep 30\n')

  const events = []
  const result = await spawnBash(scriptPath, [], {
    emit: ev => events.push(ev),
    stageName: 'prerequisites',
    stallTimeoutMs: 300
  })

  assert.equal(result.stalled, true, 'result must flag the stall')
  assert.equal(result.killed, true, 'the blocked child must actually be killed')
  // The user sees the reason in the live log, not just in the final error.
  assert.ok(
    events.some(ev => ev.type === 'log' && /no output/i.test(ev.line || '')),
    `expected a stall log line, got: ${JSON.stringify(events)}`
  )
})

test('spawnBash lets a slow-but-talking stage run to completion', { skip: isWindows }, async () => {
  // Total runtime exceeds the stall window, but each gap between lines does not.
  const scriptPath = writeScript(
    '#!/bin/bash\nfor i in 1 2 3 4 5 6; do echo "tick $i"; sleep 0.1; done\necho done\n'
  )

  const result = await spawnBash(scriptPath, [], {
    emit: () => {},
    stageName: 'python-deps',
    stallTimeoutMs: 400
  })

  assert.equal(result.stalled, undefined, 'a stage that keeps talking is not stalled')
  assert.equal(result.killed, false)
  assert.equal(result.code, 0)
  assert.match(result.stdout, /tick 6/)
})

test('stallErrorMessage names the stage, the wait, and the log to read', () => {
  const msg = stallErrorMessage('prerequisites', 900000, '/Users/x/.basecamp/logs/bootstrap-1.log')

  assert.match(msg, /prerequisites/)
  assert.match(msg, /15 minutes/, 'the wait must be stated in minutes, not milliseconds')
  assert.match(msg, /\/Users\/x\/\.basecamp\/logs\/bootstrap-1\.log/)
})

test('stallErrorMessage still reads sensibly with no log path', () => {
  const msg = stallErrorMessage('python-deps', 60000, null)
  assert.match(msg, /python-deps/)
  assert.match(msg, /1 minute\b/)
  assert.doesNotMatch(msg, /null/)
})

test('the default stall window is long enough for a slow first install', () => {
  // Downloading Node + uv + the Python wheels on a slow link is minutes of
  // work, but every one of those steps prints progress. Too short a window
  // turns a slow install into a false failure.
  assert.ok(STAGE_STALL_TIMEOUT_MS >= 5 * 60 * 1000, 'at least 5 minutes')
  assert.ok(STAGE_STALL_TIMEOUT_MS <= 20 * 60 * 1000, 'at most 20 minutes')
})
