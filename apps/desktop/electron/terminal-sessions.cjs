'use strict'

// Terminal-sessions: track claude CLI sessions launched inside Basecamp's
// built-in terminal, and serve them to the renderer's Sessions panel.
//
// Self-contained (mirrors studio.cjs): main.cjs wires it in one line. Do NOT
// require('electron') at top level - node --test loads this file directly.
// BrowserWindow is lazy-required only inside the fs.watch broadcast.
//
// Storage under userData/terminal-sessions/:
//   bin/claude, bin/claude.cmd   materialized PATH shim (in-app scope gate)
//   launches.jsonl               one {id,cwd,gitRoot,ts,kind} per fresh launch

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// ---- PATH / env injection -------------------------------------------------

// First `claude` on pathEnv that is not binDir (so the shim never resolves to
// itself), or '' when none. Windows also accepts .cmd/.exe.
function resolveRealClaude(pathEnv, binDir) {
  const dirs = String(pathEnv || '')
    .split(path.delimiter)
    .filter(Boolean)
  const names = process.platform === 'win32' ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude']
  const skip = path.resolve(binDir || '')
  for (const dir of dirs) {
    if (path.resolve(dir) === skip) continue
    for (const name of names) {
      const candidate = path.join(dir, name)
      try {
        if (process.platform === 'win32') {
          if (fs.existsSync(candidate)) return candidate
        } else {
          fs.accessSync(candidate, fs.constants.X_OK)
          return candidate
        }
      } catch {
        // not here; keep looking
      }
    }
  }
  return ''
}

// Resolve real-claude off the un-prefixed PATH FIRST, then prepend binDir LAST,
// so BASECAMP_REAL_CLAUDE can never point at the shim.
function applyEnvWith(env, { binDir, storeDir }) {
  const original = env.PATH || ''
  env.BASECAMP_REAL_CLAUDE = resolveRealClaude(original, binDir)
  env.BASECAMP_TS_DIR = storeDir
  env.PATH = binDir + path.delimiter + original
  return env
}

// ---- shim materialize -----------------------------------------------------

// Copy the bundled shim out of the (possibly asar-packed) resources dir into a
// real, writable, executable path. Refreshed every call so a version bump ships
// new shim behavior.
function materializeShim(binDir) {
  fs.mkdirSync(binDir, { recursive: true })
  const srcDir = path.join(__dirname, 'resources', 'claude-shim')
  const claude = path.join(binDir, 'claude')
  const cmd = path.join(binDir, 'claude.cmd')
  fs.copyFileSync(path.join(srcDir, 'claude'), claude)
  fs.copyFileSync(path.join(srcDir, 'claude.cmd'), cmd)
  try {
    fs.chmodSync(claude, 0o755)
  } catch {
    // Windows: chmod is a no-op / may throw; ignore.
  }
  return { claude, cmd }
}

// ---- store: merge launches.jsonl (scope gate) with claude transcripts ------

function slugForCwd(cwd) {
  return String(cwd || '').replace(/[/. ]/g, '-')
}

function parseLaunches(text) {
  const out = []
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const rec = JSON.parse(trimmed)
      if (rec && typeof rec.id === 'string') out.push(rec)
    } catch {
      // corrupt line - skip
    }
  }
  return out
}

function findTranscriptPath(claudeProjectsDir, id, cwd) {
  const bySlug = path.join(claudeProjectsDir, slugForCwd(cwd), `${id}.jsonl`)
  if (fs.existsSync(bySlug)) return bySlug
  let entries = []
  try {
    entries = fs.readdirSync(claudeProjectsDir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(claudeProjectsDir, entry.name, `${id}.jsonl`)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

// Content of a jsonl record's message, flattened to text.
function messageText(rec) {
  const content = rec && rec.message && rec.message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : part && part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join(' ')
  }
  return ''
}

function parseTranscriptTurns(text) {
  const turns = []
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let rec
    try {
      rec = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (rec.type !== 'user' && rec.type !== 'assistant') continue
    const body = messageText(rec).trim()
    if (!body) continue
    turns.push({ role: rec.type, text: body, ts: rec.timestamp || '' })
  }
  return turns
}

function readTranscriptMeta(transcriptPath, statFn = fs.statSync) {
  const meta = { title: '', messageCount: 0, cwd: '', gitBranch: '', lastActiveAt: 0 }
  let text = ''
  try {
    text = fs.readFileSync(transcriptPath, 'utf8')
    meta.lastActiveAt = statFn(transcriptPath).mtimeMs
  } catch {
    return meta
  }
  let summary = ''
  let firstUser = ''
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let rec
    try {
      rec = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (rec.cwd && !meta.cwd) meta.cwd = rec.cwd
    if (rec.gitBranch && !meta.gitBranch) meta.gitBranch = rec.gitBranch
    if (rec.type === 'summary' && !summary) summary = String(rec.summary || messageText(rec) || '').trim()
    if (rec.type === 'user' || rec.type === 'assistant') {
      meta.messageCount += 1
      if (rec.type === 'user' && !firstUser) firstUser = messageText(rec).trim()
    }
  }
  const raw = summary || firstUser
  meta.title = raw.length > 80 ? raw.slice(0, 80).trimEnd() : raw
  return meta
}

function buildSessionList({ launchesText, claudeProjectsDir, statFn = fs.statSync }) {
  const launches = parseLaunches(launchesText)
  const sessions = []
  for (const launch of launches) {
    const transcriptPath = findTranscriptPath(claudeProjectsDir, launch.id, launch.cwd)
    const meta = transcriptPath ? readTranscriptMeta(transcriptPath, statFn) : null
    const cwd = (meta && meta.cwd) || launch.cwd || ''
    const projectPath = launch.gitRoot || cwd
    sessions.push({
      id: launch.id,
      title: (meta && meta.title) || `${String(launch.id).slice(0, 8)}`,
      startedAt: launch.ts || 0,
      lastActiveAt: (meta && meta.lastActiveAt) || launch.ts || 0,
      messageCount: (meta && meta.messageCount) || 0,
      cwd,
      gitBranch: (meta && meta.gitBranch) || '',
      transcriptPath: transcriptPath || '',
      transcriptAvailable: Boolean(transcriptPath),
      projectPath
    })
  }
  const byProject = new Map()
  for (const s of sessions) {
    const key = s.projectPath || s.cwd || 'unknown'
    const existing = byProject.get(key) || {
      path: key,
      name: path.basename(key) || key,
      sessionCount: 0,
      lastActiveAt: 0,
      gitBranch: s.gitBranch
    }
    existing.sessionCount += 1
    existing.lastActiveAt = Math.max(existing.lastActiveAt, s.lastActiveAt)
    if (!existing.gitBranch && s.gitBranch) existing.gitBranch = s.gitBranch
    byProject.set(key, existing)
  }
  const projects = [...byProject.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  return { projects, sessions }
}

// ---- registration ---------------------------------------------------------

function registerTerminalSessionsIpc({ ipcMain, app, watch = true }) {
  const storeDir = path.join(app.getPath('userData'), 'terminal-sessions')
  const binDir = path.join(storeDir, 'bin')
  fs.mkdirSync(storeDir, { recursive: true })
  materializeShim(binDir)

  // (IPC handlers + fs.watch are added in later tasks.)
  void ipcMain
  void watch

  return {
    binDir,
    storeDir,
    resolveRealClaude: pathEnv => resolveRealClaude(pathEnv, binDir),
    applyEnv: env => applyEnvWith(env, { binDir, storeDir })
  }
}

module.exports = {
  applyEnvWith,
  materializeShim,
  registerTerminalSessionsIpc,
  resolveRealClaude,
  buildSessionList,
  findTranscriptPath,
  parseLaunches,
  parseTranscriptTurns,
  readTranscriptMeta,
  slugForCwd
}
