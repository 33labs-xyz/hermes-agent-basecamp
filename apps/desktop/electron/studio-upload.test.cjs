'use strict'

/**
 * Signed-upload IPC handler (studio:muapi:uploadSigned) + its URL allowlist.
 * Run with: node --test electron/studio-upload.test.cjs
 * (Wired into npm test:desktop:platforms in package.json.)
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { assertDownloadUrl, assertSignedUploadUrl, registerStudioIpc } = require('./studio.cjs')

test('assertSignedUploadUrl accepts MuAPI hosts and S3 presigned shapes', () => {
  const accepted = [
    'https://api.muapi.ai/app/get_file_upload_url',
    'https://upload.muapi.ai/files',
    'https://muapi.ai/upload',
    'https://bucket.s3.amazonaws.com/key',
    'https://bucket.s3.us-west-2.amazonaws.com/key?X-Amz-Signature=abc',
    'https://s3.amazonaws.com/bucket/key',
    'https://s3.eu-central-1.amazonaws.com/bucket/key',
    'https://s3-us-west-2.amazonaws.com/bucket/key'
  ]
  for (const url of accepted) {
    assert.doesNotThrow(() => assertSignedUploadUrl(url), url)
  }
})

test('assertSignedUploadUrl refuses everything else', () => {
  const refused = [
    'http://api.muapi.ai/insecure', // https only
    'https://example.com/upload',
    'https://evilmuapi.ai/upload', // suffix must be a label boundary
    'https://s3.amazonaws.com.evil.com/key', // lookalike suffix
    'https://notas3.amazonaws.com/key',
    'https://192.168.1.5/upload', // IP literals never match the allowlist
    'https://127.0.0.1/upload',
    'https://localhost/upload',
    'not a url'
  ]
  for (const url of refused) {
    assert.throws(() => assertSignedUploadUrl(url), undefined, url)
  }
})

test('assertDownloadUrl accepts https URLs on public/unrecognized hosts', () => {
  const accepted = [
    'https://cdn.example-provider.com/generations/abc.png',
    'https://api.muapi.ai/files/result.mp4',
    'https://some-other-cdn.io/output.wav',
    'https://8.8.8.8/file.png' // public IP literal: not in any blocked range
  ]
  for (const url of accepted) {
    assert.doesNotThrow(() => assertDownloadUrl(url), url)
  }
})

test('assertDownloadUrl refuses non-https and loopback/private/link-local/localhost targets', () => {
  const refused = [
    'http://cdn.example-provider.com/generations/abc.png', // https only
    'https://localhost/admin',
    'https://localhost:8080/admin',
    'https://127.0.0.1/',
    'https://127.5.5.5/', // any 127.0.0.0/8 address is loopback
    'https://169.254.169.254/latest/meta-data/', // cloud metadata endpoint
    'https://10.0.0.5/internal',
    'https://172.16.0.1/internal',
    'https://172.31.255.255/internal',
    'https://192.168.1.1/router',
    'https://[::1]/admin'
  ]
  for (const url of refused) {
    assert.throws(() => assertDownloadUrl(url), undefined, url)
  }
})

test('assertDownloadUrl does not misclassify adjacent public ranges as private', () => {
  const accepted = [
    'https://172.15.255.255/', // just below the 172.16/12 private block
    'https://172.32.0.1/', // just above the 172.16/12 private block
    'https://11.0.0.1/' // outside 10.0.0.0/8
  ]
  for (const url of accepted) {
    assert.doesNotThrow(() => assertDownloadUrl(url), url)
  }
})

// ---- handler wiring ---------------------------------------------------------

function setup() {
  const handlers = new Map()
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) }
  const app = { getPath: () => fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-')) }
  const safeStorage = {
    isEncryptionAvailable: () => false,
    encryptString: value => Buffer.from(value),
    decryptString: buffer => String(buffer)
  }
  registerStudioIpc({ ipcMain, app, safeStorage })
  return handlers
}

function fileBytes() {
  return new Uint8Array([1, 2, 3, 4])
}

test('uploadSigned posts an ordered multipart form with the file last and no api key', async () => {
  const handlers = setup()
  const uploadSigned = handlers.get('studio:muapi:uploadSigned')
  assert.ok(uploadSigned, 'studio:muapi:uploadSigned handler registered')

  let captured = null
  const realFetch = global.fetch
  global.fetch = async (url, init) => {
    captured = { url: String(url), init }
    return new Response('uploaded', { status: 200, statusText: 'OK' })
  }

  try {
    const result = await uploadSigned(null, {
      url: 'https://bucket.s3.amazonaws.com/key',
      parts: [
        { kind: 'field', name: 'key', value: 'uploads/abc' },
        // Caller order puts the file in the middle; S3 ignores fields after
        // the file, so the handler must still send it last.
        { kind: 'file', name: 'file', filename: 'photo.png', type: 'image/png', bytes: fileBytes() },
        { kind: 'field', name: 'policy', value: 'signed-policy' }
      ]
    })

    assert.deepEqual(result, { ok: true, status: 200, statusText: 'OK', body: 'uploaded' })
    assert.equal(captured.init.method, 'POST')
    assert.equal(captured.init.headers, undefined, 'presigned uploads carry no headers')

    const entries = [...captured.init.body.entries()]
    assert.deepEqual(
      entries.map(([name]) => name),
      ['key', 'policy', 'file']
    )
    const file = entries[2][1]
    assert.equal(file.name, 'photo.png')
    assert.equal(file.type, 'image/png')
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), fileBytes())
  } finally {
    global.fetch = realFetch
  }
})

test('gen:save refuses to download from an SSRF target reached via the real handler', async () => {
  const handlers = setup()
  const save = handlers.get('studio:gen:save')
  assert.ok(save, 'studio:gen:save handler registered')

  const realFetch = global.fetch
  let fetchCalled = false
  global.fetch = async () => {
    fetchCalled = true
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
  }

  try {
    await assert.rejects(
      save(null, { url: 'https://169.254.169.254/latest/meta-data/', prompt: 'p', model: 'm', tab: 't' }),
      /Refusing/
    )
    assert.equal(fetchCalled, false, 'fetch must never run once the URL is rejected')
  } finally {
    global.fetch = realFetch
  }
})

test('gen:save downloads a normal https result URL via the real handler', async () => {
  const handlers = setup()
  const save = handlers.get('studio:gen:save')

  const realFetch = global.fetch
  global.fetch = async () =>
    new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'content-type': 'image/png' } })

  try {
    const result = await save(null, {
      url: 'https://cdn.example-provider.com/result.png',
      prompt: 'a cat',
      model: 'test-model',
      tab: 'image'
    })
    assert.equal(result.kind, 'image')
    assert.ok(fs.existsSync(result.path))
  } finally {
    global.fetch = realFetch
  }
})

test('uploadSigned rejects disallowed URLs, missing file parts, and missing bytes', async () => {
  const handlers = setup()
  const uploadSigned = handlers.get('studio:muapi:uploadSigned')

  const filePart = { kind: 'file', name: 'file', filename: 'a.png', type: 'image/png', bytes: fileBytes() }

  await assert.rejects(
    uploadSigned(null, { url: 'https://example.com/upload', parts: [filePart] }),
    /Refusing/
  )
  await assert.rejects(
    uploadSigned(null, {
      url: 'https://bucket.s3.amazonaws.com/key',
      parts: [{ kind: 'field', name: 'key', value: 'v' }]
    }),
    /no file part/
  )
  await assert.rejects(
    uploadSigned(null, {
      url: 'https://bucket.s3.amazonaws.com/key',
      parts: [{ kind: 'file', name: 'file', filename: 'a.png', type: 'image/png' }]
    }),
    /missing bytes/
  )
})
