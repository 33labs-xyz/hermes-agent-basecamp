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
  resolveRealClaude
}
