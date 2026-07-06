const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { resolveDeletableFilePath } = require('./artifact-file-guard.cjs')

const HOME = '/Users/testuser'
const TMP = '/tmp/test-tmp'

function isFileStat(isFile) {
  return { isFile: () => isFile }
}

test('non-string input (number) returns ok:false', () => {
  const result = resolveDeletableFilePath(42, { homeDir: HOME, tmpDir: TMP })
  assert.equal(result.ok, false)
})

test('non-string input (null) returns ok:false', () => {
  const result = resolveDeletableFilePath(null, { homeDir: HOME, tmpDir: TMP })
  assert.equal(result.ok, false)
})

test('non-string input (undefined) returns ok:false', () => {
  const result = resolveDeletableFilePath(undefined, { homeDir: HOME, tmpDir: TMP })
  assert.equal(result.ok, false)
})

test('empty string returns ok:false', () => {
  const result = resolveDeletableFilePath('', { homeDir: HOME, tmpDir: TMP })
  assert.equal(result.ok, false)
})

test('whitespace-only string returns ok:false', () => {
  const result = resolveDeletableFilePath('   ', { homeDir: HOME, tmpDir: TMP })
  assert.equal(result.ok, false)
})

test('relative path returns ok:false (not absolute)', () => {
  const result = resolveDeletableFilePath('./x', { homeDir: HOME, tmpDir: TMP })
  assert.equal(result.ok, false)
})

test('absolute file outside roots is rejected even when statFn says it is a real file', () => {
  const statFn = () => isFileStat(true)
  const result = resolveDeletableFilePath('/etc/passwd', { homeDir: HOME, tmpDir: TMP, statFn })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'outside allowed roots')
})

test('path that escapes home via .. is rejected', () => {
  const statFn = () => isFileStat(true)
  const result = resolveDeletableFilePath('~/../../etc/x', { homeDir: HOME, tmpDir: TMP, statFn })
  assert.equal(result.ok, false)
})

test('path under home that is a directory (not a regular file) is rejected', () => {
  const statFn = () => isFileStat(false)
  const result = resolveDeletableFilePath(path.join(HOME, 'somedir'), { homeDir: HOME, tmpDir: TMP, statFn })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'not a regular file')
})

test('path under home that is a regular file resolves ok:true with the resolved absolute path', () => {
  const statFn = () => isFileStat(true)
  const target = path.join(HOME, 'a.png')
  const result = resolveDeletableFilePath(target, { homeDir: HOME, tmpDir: TMP, statFn })
  assert.equal(result.ok, true)
  assert.equal(result.path, path.resolve(target))
})

test('~/ expands against injected homeDir and resolves ok:true', () => {
  const statFn = () => isFileStat(true)
  const result = resolveDeletableFilePath('~/a.png', { homeDir: HOME, tmpDir: TMP, statFn })
  assert.equal(result.ok, true)
  assert.equal(result.path, path.resolve(path.join(HOME, 'a.png')))
})

test('file:// URL under home resolves ok:true', () => {
  const statFn = () => isFileStat(true)
  const result = resolveDeletableFilePath(`file://${HOME}/a.png`, { homeDir: HOME, tmpDir: TMP, statFn })
  assert.equal(result.ok, true)
  assert.equal(result.path, path.resolve(path.join(HOME, 'a.png')))
})

test('file under injected tmpDir resolves ok:true (second root)', () => {
  const statFn = () => isFileStat(true)
  const target = path.join(TMP, 'b.png')
  const result = resolveDeletableFilePath(target, { homeDir: HOME, tmpDir: TMP, statFn })
  assert.equal(result.ok, true)
  assert.equal(result.path, path.resolve(target))
})

test('statFn throwing returns ok:false with not found error', () => {
  const statFn = () => {
    throw new Error('ENOENT')
  }
  const target = path.join(HOME, 'missing.png')
  const result = resolveDeletableFilePath(target, { homeDir: HOME, tmpDir: TMP, statFn })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'not found')
})

test('does not mutate the opts object passed in', () => {
  const statFn = () => isFileStat(true)
  const opts = { homeDir: HOME, tmpDir: TMP, statFn }
  const optsCopy = { ...opts }
  resolveDeletableFilePath(path.join(HOME, 'a.png'), opts)
  assert.deepEqual(Object.keys(opts), Object.keys(optsCopy))
  assert.equal(opts.homeDir, optsCopy.homeDir)
  assert.equal(opts.tmpDir, optsCopy.tmpDir)
})

test('path containing a NUL byte is rejected (never reaches unlink)', () => {
  const statFn = () => isFileStat(true)
  const nul = String.fromCharCode(0)
  const result = resolveDeletableFilePath(`${HOME}/a${nul}.png`, { homeDir: HOME, tmpDir: TMP, statFn })
  assert.equal(result.ok, false)
})
