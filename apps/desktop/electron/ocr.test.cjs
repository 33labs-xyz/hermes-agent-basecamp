'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { MAX_IMAGE_BYTES, extractImageText } = require('./ocr.cjs')

function fakeWorkerFactory(result, calls = []) {
  return async language => {
    calls.push(language)
    return {
      recognize: async data => {
        calls.push(data)
        return result
      },
      terminate: async () => {
        calls.push('terminated')
      }
    }
  }
}

test('returns the recognised text', async () => {
  const createWorker = fakeWorkerFactory({ data: { text: '  invoice total 42  ' } })
  const text = await extractImageText(Buffer.from('png-bytes'), { createWorker })

  assert.equal(text, 'invoice total 42')
})

test('creates the worker for the requested language and terminates it', async () => {
  const calls = []
  const createWorker = fakeWorkerFactory({ data: { text: 'hi' } }, calls)
  await extractImageText(Buffer.from('png-bytes'), { createWorker, language: 'deu' })

  assert.equal(calls[0], 'deu')
  assert.equal(calls.at(-1), 'terminated')
})

test('terminates the worker even when recognition throws', async () => {
  const calls = []
  const createWorker = async () => ({
    recognize: async () => {
      throw new Error('boom')
    },
    terminate: async () => {
      calls.push('terminated')
    }
  })

  await assert.rejects(() => extractImageText(Buffer.from('png-bytes'), { createWorker }))
  assert.deepEqual(calls, ['terminated'])
})

test('rejects an image with no readable text', async () => {
  const createWorker = fakeWorkerFactory({ data: { text: '   \n  ' } })

  await assert.rejects(
    () => extractImageText(Buffer.from('png-bytes'), { createWorker }),
    error => error.code === 'no-text'
  )
})

test('rejects empty input', async () => {
  const createWorker = fakeWorkerFactory({ data: { text: 'unused' } })

  await assert.rejects(
    () => extractImageText(Buffer.alloc(0), { createWorker }),
    error => error.code === 'no-text'
  )
})

test('rejects an image over the size cap before starting a worker', async () => {
  let created = false
  const createWorker = async () => {
    created = true
    return { recognize: async () => ({ data: { text: 'x' } }), terminate: async () => {} }
  }

  await assert.rejects(
    () => extractImageText(Buffer.alloc(MAX_IMAGE_BYTES + 1), { createWorker }),
    error => error.code === 'too-large'
  )
  assert.equal(created, false)
})

test('accepts an ArrayBuffer as it arrives over IPC', async () => {
  const createWorker = fakeWorkerFactory({ data: { text: 'from array buffer' } })
  const bytes = new Uint8Array([1, 2, 3])
  const text = await extractImageText(bytes.buffer, { createWorker })

  assert.equal(text, 'from array buffer')
})
