/**
 * Guards the desktop *client* version shown in the About panel + statusbar.
 *
 * Basecamp's product identity is the packaged desktop release you download
 * (e.g. 0.17.7), NOT the bundled Hermes Python backend version. An earlier
 * implementation derived the displayed version from
 * `hermes_cli/__init__.py __version__`, resolved against the *installed*
 * backend tree — which lagged (showed 0.16.0 while the app was 0.17.6),
 * producing the confusing native macOS string "Version 0.16.0 (0.17.6)" and a
 * stale `v0.16.0` in the statusbar. The client version must come from
 * app.getVersion() so About + statusbar always match the installed build.
 *
 * Run with: node --test electron/client-version.test.cjs
 * (Wired into npm test:desktop:platforms in package.json.)
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const MAIN = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')

test('hermes:version IPC reports app.getVersion() as the client appVersion', () => {
  const handler = MAIN.match(/ipcMain\.handle\('hermes:version'[\s\S]*?\}\)\)/)
  assert.ok(handler, 'hermes:version handler present')
  assert.match(handler[0], /appVersion:\s*app\.getVersion\(\)/)
})

test('client version is not derived from the Hermes backend __version__ file', () => {
  // No helper that parses hermes_cli/__init__.py for the displayed version.
  assert.doesNotMatch(MAIN, /resolveHermesVersion/)
  assert.doesNotMatch(MAIN, /'hermes_cli',\s*'__init__\.py'/)
})

test('native About panel uses app.getVersion() for applicationVersion', () => {
  const setters = [...MAIN.matchAll(/setAboutPanelOptions\(\{[\s\S]*?\}\)/g)]
  assert.ok(setters.length >= 1, 'at least one About panel setup present')
  for (const s of setters) {
    assert.match(s[0], /applicationVersion:\s*app\.getVersion\(\)/)
  }
})
