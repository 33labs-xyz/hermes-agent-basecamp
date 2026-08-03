'use strict'

// OCR runs here in the main process, not the renderer: the packaged renderer is
// loaded from file:// with sandbox on, which blocks the worker, wasm and
// traineddata fetches tesseract.js needs. The renderer hands us the raw image
// bytes over IPC and gets plain text back.

const path = require('node:path')

// Big enough for a retina screenshot, small enough that a stray file cannot
// pin the main process for minutes.
const MAX_IMAGE_BYTES = 12 * 1024 * 1024

function ocrError(code, message) {
  const error = new Error(message)
  error.code = code

  return error
}

// tesseract.js is staged into resources/native-deps for the packaged app, the
// same way electron-updater is.
function loadCreateWorker() {
  try {
    return require('tesseract.js').createWorker
  } catch {
    const staged = process.resourcesPath
      ? path.join(process.resourcesPath, 'native-deps', 'node_modules', 'tesseract.js')
      : null

    if (!staged) {
      throw ocrError('unavailable', 'OCR is not available in this build')
    }

    return require(staged).createWorker
  }
}

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) {
    return bytes
  }

  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
}

/**
 * Read the text out of an image.
 *
 * @param {Buffer|ArrayBuffer|Uint8Array} bytes raw image bytes
 * @param {{createWorker?: Function, language?: string, cachePath?: string}} [options]
 * @returns {Promise<string>} the recognised text, trimmed
 */
async function extractImageText(bytes, options = {}) {
  const buffer = toBuffer(bytes)

  if (buffer.length > MAX_IMAGE_BYTES) {
    throw ocrError('too-large', 'Image is too large to read')
  }

  if (buffer.length === 0) {
    throw ocrError('no-text', 'No text could be read from the image')
  }

  const createWorker = options.createWorker || loadCreateWorker()
  const language = options.language || 'eng'
  const workerOptions = options.cachePath ? { cachePath: options.cachePath } : undefined
  const worker = await createWorker(language, undefined, workerOptions)

  try {
    const result = await worker.recognize(buffer)
    const text = (result?.data?.text || '').trim()

    if (!text) {
      throw ocrError('no-text', 'No text could be read from the image')
    }

    return text
  } finally {
    await worker.terminate()
  }
}

module.exports = { MAX_IMAGE_BYTES, extractImageText }
