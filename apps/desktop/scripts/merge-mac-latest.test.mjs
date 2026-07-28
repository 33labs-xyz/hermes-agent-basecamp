import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { sha512Base64, fileEntry, buildManifest } from './merge-mac-latest.mjs'

// sha512Base64 must reproduce electron-builder's format: base64 of the raw
// SHA-512 digest (NOT hex). This is the exact algorithm the updater verifies
// against, so a wrong encoding here ships a corrupt auto-update manifest.
test('sha512Base64 returns base64 of the raw SHA-512 digest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'merge-mac-'))
  try {
    const f = join(dir, 'blob.bin')
    const bytes = Buffer.from('the quick brown fox', 'utf8')
    writeFileSync(f, bytes)
    const expected = createHash('sha512').update(bytes).digest('base64')
    assert.equal(sha512Base64(f), expected)
    // base64, not hex: a 128-char [0-9a-f] string would mean hex encoding.
    assert.equal(/^[0-9a-f]{128}$/.test(sha512Base64(f)), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('fileEntry reports url, base64 sha512, and byte size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'merge-mac-'))
  try {
    const bytes = Buffer.alloc(1234, 7)
    writeFileSync(join(dir, 'Basecamp-9.9.9-mac-x64.zip'), bytes)
    const e = fileEntry(dir, 'Basecamp-9.9.9-mac-x64.zip')
    assert.equal(e.url, 'Basecamp-9.9.9-mac-x64.zip')
    assert.equal(e.size, 1234)
    assert.equal(e.sha512, createHash('sha512').update(bytes).digest('base64'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('buildManifest lists all files and points path/sha512 at the arm64 zip', () => {
  const files = [
    { url: 'Basecamp-1.0.0-mac-arm64.zip', sha512: 'ARM64ZIP', size: 10 },
    { url: 'Basecamp-1.0.0-mac-arm64.dmg', sha512: 'ARM64DMG', size: 11 },
    { url: 'Basecamp-1.0.0-mac-x64.zip', sha512: 'X64ZIP', size: 12 },
    { url: 'Basecamp-1.0.0-mac-x64.dmg', sha512: 'X64DMG', size: 13 },
  ]
  const yml = buildManifest({ version: '1.0.0', files, releaseDate: '2026-07-28T00:00:00.000Z' })

  // Every artifact appears in files[].
  for (const f of files) assert.match(yml, new RegExp(`url: ${f.url}`))
  // Top-level path + sha512 are the arm64 zip (backward-compat primary).
  assert.match(yml, /\npath: Basecamp-1\.0\.0-mac-arm64\.zip\n/)
  assert.match(yml, /\nsha512: ARM64ZIP\n/)
  // releaseDate is single-quoted like electron-builder emits.
  assert.match(yml, /\nreleaseDate: '2026-07-28T00:00:00\.000Z'\n/)
  assert.match(yml, /^version: 1\.0\.0\n/)
})

test('buildManifest falls back to first file when no arm64 zip present', () => {
  const files = [{ url: 'Basecamp-1.0.0-mac-x64.zip', sha512: 'X64ZIP', size: 12 }]
  const yml = buildManifest({ version: '1.0.0', files, releaseDate: '2026-07-28T00:00:00.000Z' })
  assert.match(yml, /\npath: Basecamp-1\.0\.0-mac-x64\.zip\n/)
  assert.match(yml, /\nsha512: X64ZIP\n/)
})
