'use strict'

/**
 * studio:gen:list must hide entries whose backing file was deleted on disk, so
 * the Artifacts gallery and the Studio Library stop rendering empty shells for
 * images the user removed from the local folder.
 * Run with: node --test electron/studio-gen-list.test.cjs
 * (Wired into npm test:desktop:platforms in package.json.)
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { registerStudioIpc } = require('./studio.cjs')

// Registers the studio IPC against a throwaway userData dir and returns both the
// captured handler map and that dir, so a test can plant/remove generation
// files directly on disk.
function setup() {
  const handlers = new Map()
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-gen-list-'))
  const app = { getPath: () => userData }
  const safeStorage = {
    isEncryptionAvailable: () => false,
    encryptString: value => Buffer.from(value),
    decryptString: buffer => String(buffer)
  }
  registerStudioIpc({ ipcMain, app, safeStorage })
  return { handlers, userData }
}

// Writes generations.json under the studio root and returns the active dir so a
// test can plant (or omit) the per-entry files those entries point at.
function seedIndex(userData, entries) {
  const activeDir = path.join(userData, 'studio', 'generations', 'active')
  fs.mkdirSync(activeDir, { recursive: true })
  fs.writeFileSync(path.join(userData, 'studio', 'generations.json'), JSON.stringify(entries, null, 2))
  return activeDir
}

test('studio:gen:list returns only entries whose file exists on disk', () => {
  const { handlers, userData } = setup()
  const list = handlers.get('studio:gen:list')
  assert.ok(list, 'studio:gen:list handler registered')

  const activeDir = seedIndex(userData, [
    { id: 'present', ext: '.png', kind: 'image', archived: false },
    { id: 'gone', ext: '.png', kind: 'image', archived: false }
  ])
  // Only 'present' still has bytes on disk; 'gone' was deleted from the folder.
  fs.writeFileSync(path.join(activeDir, 'present.png'), Buffer.from([1, 2, 3]))

  const result = list()
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'present')
  assert.ok(result[0].path.endsWith(path.join('active', 'present.png')))
})

test('studio:gen:list returns [] when every backing file is missing', () => {
  const { handlers, userData } = setup()
  const list = handlers.get('studio:gen:list')

  seedIndex(userData, [
    { id: 'a', ext: '.png', kind: 'image', archived: false },
    { id: 'b', ext: '.mp4', kind: 'video', archived: false }
  ])
  // No files planted: both entries point at deleted files.

  assert.deepEqual(list(), [])
})
