// Studio backend: everything the vendored generative-AI studio needs from the
// main process. Kept self-contained so main.cjs only wires it in one line.
//
// Responsibilities:
//  - Muapi key at rest, OS-encrypted via safeStorage (studio:key:*)
//  - HTTP proxy for Muapi calls so the http renderer bypasses CORS
//    (studio:muapi:request / studio:muapi:upload). The renderer passes its own
//    key per call; main just relays.
//  - Local generation library: auto-saved results on disk + a JSON index,
//    archive-first delete, and foldering (studio:gen:*).
//
// Storage layout under userData/studio/:
//   muapi-key.json                   encrypted key blob
//   generations.json                 index (array of entries)
//   generations/active/<id>.<ext>    live files
//   generations/archive/<id>.<ext>   soft-deleted files (recoverable)

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const MUAPI_HOSTS = new Set(['api.muapi.ai'])
const MAX_BYTES = 512 * 1024 * 1024 // 512MB hard ceiling per generation file

function extForMime(mime) {
  const map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/webm': '.weba'
  }
  return map[String(mime || '').toLowerCase().split(';')[0]] || ''
}

function extFromUrl(url) {
  try {
    const clean = new URL(url).pathname
    const ext = path.extname(clean).toLowerCase()
    return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : ''
  } catch {
    return ''
  }
}

// Coarse media class from a mime/ext, used for the deterministic default folder.
function kindFor(mime, ext) {
  const m = String(mime || '').toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  const e = String(ext || '').toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(e)) return 'image'
  if (['.mp4', '.webm', '.mov'].includes(e)) return 'video'
  if (['.mp3', '.m4a', '.wav', '.weba'].includes(e)) return 'audio'
  return 'other'
}

function assertMuapiUrl(rawUrl) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' || !MUAPI_HOSTS.has(url.hostname)) {
    throw new Error(`Refusing non-Muapi URL: ${url.hostname}`)
  }
  return url
}

// Hosts a presigned upload may target: MuAPI's own domains plus the S3
// endpoint shapes its get_upload_url API hands back (virtual-hosted and
// path-style, with or without a region, including the legacy dashed form).
const S3_UPLOAD_HOST = /^(?:[a-z0-9][a-z0-9.-]*\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/

// Allowlist, not blocklist: anything that isn't a recognized upload host is
// refused, which inherently blocks IP literals, localhost, and private ranges.
function assertSignedUploadUrl(rawUrl) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:') {
    throw new Error(`Refusing non-https upload URL: ${rawUrl}`)
  }
  const host = url.hostname.toLowerCase()
  if (host === 'muapi.ai' || host.endsWith('.muapi.ai') || S3_UPLOAD_HOST.test(host)) {
    return url
  }
  throw new Error(`Refusing upload to unrecognized host: ${host}`)
}

// Generation result URLs come from varied provider CDNs, so this is a
// blocklist (not the allowlist the upload guards above use): any https
// hostname is accepted unless it's a loopback/private/link-local IP literal
// or 'localhost', which would turn a renderer-supplied URL into an SSRF
// against the local machine or internal network. DNS rebinding (a hostname
// that only resolves to a private IP at fetch time) is out of scope.
const IPV4_OCTETS = '(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})'
const IPV4_LITERAL_RE = new RegExp(`^${IPV4_OCTETS}$`)

function isPrivateIpv4(octets) {
  const [a, b] = octets
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 10) return true // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
  return false
}

function isBlockedDownloadHost(hostname) {
  const host = hostname.toLowerCase()
  if (host === 'localhost') return true

  const ipv4Match = host.match(IPV4_LITERAL_RE)
  if (ipv4Match) {
    const octets = ipv4Match.slice(1, 5).map(Number)
    if (octets.some(octet => octet > 255)) return false // not a valid IP literal
    return isPrivateIpv4(octets)
  }

  // IPv6 literals arrive from URL.hostname with brackets stripped.
  const ipv6 = host.replace(/^\[|\]$/g, '')
  if (ipv6 === '::1') return true // loopback
  if (/^fe80:/i.test(ipv6)) return true // fe80::/10 link-local
  return false
}

function assertDownloadUrl(rawUrl) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:') {
    throw new Error(`Refusing non-https download URL: ${rawUrl}`)
  }
  if (isBlockedDownloadHost(url.hostname)) {
    throw new Error(`Refusing download from disallowed host: ${url.hostname}`)
  }
  return url
}

function registerStudioIpc({ ipcMain, app, safeStorage }) {
  const root = path.join(app.getPath('userData'), 'studio')
  const keyPath = path.join(root, 'muapi-key.json')
  const indexPath = path.join(root, 'generations.json')
  const activeDir = path.join(root, 'generations', 'active')
  const archiveDir = path.join(root, 'generations', 'archive')

  function ensureDirs() {
    fs.mkdirSync(activeDir, { recursive: true })
    fs.mkdirSync(archiveDir, { recursive: true })
  }

  // ---- Muapi key (safeStorage) --------------------------------------------
  function readKey() {
    try {
      const raw = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
      if (raw?.encoding === 'safeStorage' && raw.value) {
        return safeStorage.decryptString(Buffer.from(raw.value, 'base64'))
      }
      return String(raw?.value || '')
    } catch {
      return ''
    }
  }

  function writeKey(key) {
    ensureDirs()
    const trimmed = String(key || '').trim()
    if (!trimmed) {
      try {
        fs.unlinkSync(keyPath)
      } catch {
        // already gone
      }
      return
    }
    const blob = safeStorage.isEncryptionAvailable()
      ? { encoding: 'safeStorage', value: safeStorage.encryptString(trimmed).toString('base64') }
      : { encoding: 'plain', value: trimmed }
    fs.writeFileSync(keyPath, JSON.stringify(blob), { mode: 0o600 })
  }

  ipcMain.handle('studio:key:get', () => readKey())
  ipcMain.handle('studio:key:set', (_event, key) => {
    writeKey(key)
    return true
  })

  // ---- Muapi HTTP proxy (CORS bypass) -------------------------------------
  ipcMain.handle('studio:muapi:request', async (_event, req) => {
    const url = assertMuapiUrl(req?.url)
    const method = String(req?.method || 'GET').toUpperCase()
    const headers = { ...(req?.headers || {}) }
    const init = { method, headers }
    if (method !== 'GET' && method !== 'HEAD' && req?.body != null) {
      init.body = req.body
    }
    const response = await fetch(url, init)
    const body = await response.text()
    return { ok: response.ok, status: response.status, statusText: response.statusText, body }
  })

  ipcMain.handle('studio:muapi:upload', async (_event, req) => {
    const url = assertMuapiUrl(req?.url)
    const bytes = req?.bytes
    if (!bytes) throw new Error('Upload missing bytes')
    const blob = new Blob([Buffer.from(bytes)], { type: req?.type || 'application/octet-stream' })
    const form = new FormData()
    form.append('file', blob, req?.name || 'upload')
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'x-api-key': String(req?.apiKey || '') },
      body: form
    })
    const body = await response.text()
    return { ok: response.ok, status: response.status, statusText: response.statusText, body }
  })

  // Multipart POST to a presigned upload URL (S3 or a MuAPI upload host).
  // The signature in the URL is the auth, so no api key is ever attached.
  // Used by the vendored workflow/agents/design sub-packages via the axios
  // shim, which flattens the renderer's FormData into ordered parts.
  ipcMain.handle('studio:muapi:uploadSigned', async (_event, req) => {
    const url = assertSignedUploadUrl(req?.url)
    const parts = Array.isArray(req?.parts) ? req.parts : []
    if (!parts.some(part => part?.kind === 'file')) {
      throw new Error('Signed upload has no file part')
    }

    const form = new FormData()
    // S3 presigned POST ignores fields after the file, so append every field
    // first and the file(s) last regardless of caller order.
    for (const part of parts) {
      if (part?.kind === 'field') form.append(String(part.name), String(part.value ?? ''))
    }
    for (const part of parts) {
      if (part?.kind !== 'file') continue
      if (!part.bytes) throw new Error(`File part "${part.name}" missing bytes`)
      const blob = new Blob([Buffer.from(part.bytes)], {
        type: part.type || 'application/octet-stream'
      })
      form.append(String(part.name), blob, part.filename || 'file')
    }

    const response = await fetch(url, { method: 'POST', body: form })
    const body = await response.text()
    return { ok: response.ok, status: response.status, statusText: response.statusText, body }
  })

  // ---- Local generation library -------------------------------------------
  function readIndex() {
    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  function writeIndex(entries) {
    ensureDirs()
    fs.writeFileSync(indexPath, JSON.stringify(entries, null, 2), { mode: 0o600 })
  }

  function fileFor(entry) {
    const dir = entry.archived ? archiveDir : activeDir
    return path.join(dir, `${entry.id}${entry.ext || ''}`)
  }

  async function downloadBuffer(sourceUrl) {
    if (String(sourceUrl || '').startsWith('data:')) {
      const match = sourceUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
      if (!match) throw new Error('Invalid data URL')
      const mime = match[1] || 'application/octet-stream'
      const buffer = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]), 'utf8')
      return { buffer, mime }
    }
    assertDownloadUrl(sourceUrl)
    const response = await fetch(sourceUrl)
    if (!response.ok) throw new Error(`Download failed: ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > MAX_BYTES) throw new Error('Generation exceeds size limit')
    return { buffer, mime: response.headers.get('content-type') || 'application/octet-stream' }
  }

  // Persist one finished generation to disk + index. Called by the auto-save
  // hook in the renderer as soon as a job resolves.
  ipcMain.handle('studio:gen:save', async (_event, payload) => {
    ensureDirs()
    const sourceUrl = String(payload?.url || '')
    if (!sourceUrl) throw new Error('Nothing to save: missing url')

    const { buffer, mime } = await downloadBuffer(sourceUrl)
    const ext = extForMime(mime) || extFromUrl(sourceUrl) || '.bin'
    const id = `${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`
    const kind = kindFor(mime, ext)
    const entry = {
      id,
      ext,
      kind,
      folder: kind, // deterministic default folder; hermes/organise can refine
      prompt: String(payload?.prompt || ''),
      model: String(payload?.model || ''),
      tab: String(payload?.tab || ''),
      sourceUrl,
      createdAt: new Date().toISOString(),
      archived: false
    }
    fs.writeFileSync(fileFor(entry), buffer)
    const entries = readIndex()
    entries.unshift(entry)
    writeIndex(entries)
    return { ...entry, path: fileFor(entry) }
  })

  ipcMain.handle('studio:gen:list', () => {
    // Skip entries whose file was deleted from disk outside the app, so the
    // Artifacts gallery and Studio Library never render an empty shell for a
    // generation the user removed from the local folder. The manifest keeps the
    // stale record; the list just hides it (self-heals on the next read).
    return readIndex()
      .map(entry => ({ ...entry, path: fileFor(entry) }))
      .filter(entry => fs.existsSync(entry.path))
  })

  function moveEntry(id, toArchived) {
    const entries = readIndex()
    const idx = entries.findIndex(entry => entry.id === id)
    if (idx === -1) return null
    const entry = entries[idx]
    if (entry.archived === toArchived) return { ...entry, path: fileFor(entry) }
    const from = fileFor(entry)
    const updated = { ...entry, archived: toArchived }
    const to = fileFor(updated)
    try {
      fs.renameSync(from, to)
    } catch {
      // file may be missing; keep index consistent regardless
    }
    entries[idx] = updated
    writeIndex(entries)
    return { ...updated, path: to }
  }

  // Soft delete: move file into archive/ and flag it. Reversible.
  ipcMain.handle('studio:gen:archive', (_event, id) => moveEntry(String(id), true))
  ipcMain.handle('studio:gen:restore', (_event, id) => moveEntry(String(id), false))

  // Permanent delete: only allowed from the archive (archive-first contract).
  ipcMain.handle('studio:gen:deleteForever', (_event, id) => {
    const entries = readIndex()
    const entry = entries.find(item => item.id === String(id))
    if (!entry) return false
    if (!entry.archived) throw new Error('Archive before permanent delete')
    try {
      fs.unlinkSync(fileFor(entry))
    } catch {
      // already gone
    }
    writeIndex(entries.filter(item => item.id !== String(id)))
    return true
  })

  ipcMain.handle('studio:gen:setFolder', (_event, id, folder) => {
    const entries = readIndex()
    const idx = entries.findIndex(entry => entry.id === String(id))
    if (idx === -1) return null
    entries[idx] = { ...entries[idx], folder: String(folder || entries[idx].kind) }
    writeIndex(entries)
    return { ...entries[idx], path: fileFor(entries[idx]) }
  })

  // Deterministic re-foldering pass: reset every active entry's folder to its
  // media kind. A richer hermes/LLM organise pass can layer on top later.
  ipcMain.handle('studio:gen:organise', () => {
    const entries = readIndex().map(entry => (entry.archived ? entry : { ...entry, folder: entry.kind }))
    writeIndex(entries)
    return entries.map(entry => ({ ...entry, path: fileFor(entry) }))
  })
}

module.exports = { assertDownloadUrl, assertSignedUploadUrl, registerStudioIpc }
