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

const { assertSignedUploadUrl, registerStudioIpc } = require('./studio.cjs')

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
