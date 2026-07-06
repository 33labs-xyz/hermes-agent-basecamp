const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

// Resolve a renderer-supplied path to a safe, deletable absolute file path, or
// reject. Destructive-op guard: only regular files under the user home dir or
// the OS temp dir may be deleted. Pure + injectable (homeDir/tmpDir/statFn) so
// it is unit-testable without touching the real filesystem or Electron.
function resolveDeletableFilePath(rawPath, opts = {}) {
  const homeDir = opts.homeDir || os.homedir()
  const tmpDir = opts.tmpDir || os.tmpdir()
  const statFn = opts.statFn || fs.statSync
  if (typeof rawPath !== 'string') return { ok: false, error: 'not a string' }
  let p = rawPath.trim()
  if (!p) return { ok: false, error: 'empty path' }
  if (p.startsWith('file://')) {
    try { p = require('node:url').fileURLToPath(p) } catch { return { ok: false, error: 'bad file url' } }
  }
  if (p === '~' || p.startsWith('~/')) p = path.join(homeDir, p.slice(1))
  if (p.includes(String.fromCharCode(0))) return { ok: false, error: 'invalid path' } // reject NUL byte
  if (!path.isAbsolute(p)) return { ok: false, error: 'not an absolute path' }
  const resolved = path.resolve(p) // normalises any .. segments
  const roots = [path.resolve(homeDir), path.resolve(tmpDir)]
  const underRoot = roots.some(r => resolved === r || resolved.startsWith(r + path.sep))
  if (!underRoot) return { ok: false, error: 'outside allowed roots' }
  let st
  try { st = statFn(resolved) } catch { return { ok: false, error: 'not found' } }
  if (!st.isFile()) return { ok: false, error: 'not a regular file' }
  return { ok: true, path: resolved }
}

module.exports = { resolveDeletableFilePath }
