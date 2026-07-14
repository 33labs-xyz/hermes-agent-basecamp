'use strict'

/**
 * Stage native node-modules dependencies for electron-builder packaging.
 *
 * Workspace dedup hoists `node-pty` into the root `node_modules/`, which
 * electron-builder's default file collector (when `files:` is explicitly set
 * in package.json) cannot reach.  The result: packaged builds ship with no
 * .node binaries and PTY initialization fails at runtime ("PTY support is
 * unavailable").
 *
 * Rather than restructure the workspace dedup (would require nohoist /
 * package.json shenanigans and risk breaking dev) or balloon the package
 * with the whole node_modules tree, we copy ONLY the runtime-essential
 * files of the native dep into apps/desktop/build/native-deps/ and ship
 * THAT subtree via extraResources.  main.cjs falls back to require()-ing
 * from process.resourcesPath when the hoisted-root require fails.
 *
 * Runs as part of `npm run build`. Idempotent -- always re-stages on each
 * build to pick up native binary updates.
 *
 * Layout note: upstream node-pty (microsoft/node-pty 1.x) is N-API based
 * and ships its prebuilts under `prebuilds/<platform>-<arch>/` instead of
 * `build/Release/`.  Its runtime resolver (lib/utils.js) checks
 * build/Release first and falls through to the per-arch prebuilds dir, so
 * shipping only the latter is sufficient for packaged runs.  Per-arch
 * staging keeps the resource bundle lean -- we only need the target
 * arch's prebuilt, not all of them.
 */

const fs = require('node:fs')
const path = require('node:path')

const APP_ROOT = path.resolve(__dirname, '..')
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..')
const STAGE_ROOT = path.join(APP_ROOT, 'build', 'native-deps')

// The target arch may be overridden by electron-builder via npm_config_arch
// (e.g. `npm run dist -- --arm64`); fall back to the build host's arch.
const TARGET_ARCH = process.env.npm_config_arch || process.arch
const TARGET_PLATFORM = process.platform

// Modules to stage. The "from" path is the hoisted location in the workspace
// root; "to" is the layout we want inside build/native-deps/.  The "include"
// globs (relative to "from") select the runtime-essential files.  Anything
// outside the include list is left behind (source, deps/, scripts/, etc.).
const NATIVE_DEPS = [
  {
    from: path.join(REPO_ROOT, 'node_modules', 'node-pty'),
    to: path.join(STAGE_ROOT, 'node-pty'),
    include: [
      'package.json',
      'lib/*.js',
      'lib/**/*.js',
      'build/Release/*.node',
      // Per-arch runtime payload. Explicit file types so we don't ship the
      // ~25 MB of .pdb debug symbols that prebuild-install bundles for
      // Windows crash analysis -- not used at runtime, would just bloat
      // the installer.
      `prebuilds/${TARGET_PLATFORM}-${TARGET_ARCH}/*.node`,
      `prebuilds/${TARGET_PLATFORM}-${TARGET_ARCH}/*.dll`,
      `prebuilds/${TARGET_PLATFORM}-${TARGET_ARCH}/*.exe`,
      `prebuilds/${TARGET_PLATFORM}-${TARGET_ARCH}/spawn-helper`,
      `prebuilds/${TARGET_PLATFORM}-${TARGET_ARCH}/conpty/*`
    ]
  }
]

// Pure-JS runtime modules to stage as a full node_modules subtree.
//
// Unlike the native deps above (fine-grained include globs to skip debug
// symbols), these are small pure-JS packages copied wholesale together with
// their transitive prod-dependency closure.  electron-updater powers packaged
// auto-update; the `files:` whitelist would otherwise leave it -- and its ~15
// transitive deps -- out of the bundle, so auto-updater.cjs's
// require('electron-updater') throws in the asar and every update path silently
// no-ops.  Staged into build/native-deps/node_modules/ (flat, matching the
// workspace's hoisted layout) and shipped via the same extraResources copy;
// auto-updater.cjs falls back to requiring from
// process.resourcesPath/native-deps/node_modules when the bare require fails.
const MODULE_TREES = ['electron-updater']

// node_modules search roots, in resolution order.  Workspace dedup hoists
// everything flat into the repo root; the app-local dir is a fallback for any
// dep that did not hoist.
const MODULE_SEARCH_ROOTS = [
  path.join(REPO_ROOT, 'node_modules'),
  path.join(APP_ROOT, 'node_modules')
]

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true })
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true })
}

function walk(root) {
  const results = []
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile()) {
        results.push(full)
      }
    }
  }
  return results
}

// Match a relative path against simple ** and * glob patterns. Implementation
// is intentionally tiny -- the include lists are small and don't need full
// minimatch support.
function matchGlob(rel, pattern) {
  const r = rel.replace(/\\/g, '/')
  const re = new RegExp(
    '^' +
      pattern
        .replace(/\\/g, '/')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '__DOUBLE_STAR__')
        .replace(/\*/g, '[^/]*')
        .replace(/__DOUBLE_STAR__/g, '.*') +
      '$'
  )
  return re.test(r)
}

function stageOne(spec) {
  if (!fs.existsSync(spec.from)) {
    throw new Error(
      `stage-native-deps: source missing at ${spec.from}.  Run \`npm install\` ` +
        `at the workspace root first.`
    )
  }
  rmrf(spec.to)
  ensureDir(spec.to)

  const files = walk(spec.from)
  let copied = 0
  for (const abs of files) {
    const rel = path.relative(spec.from, abs)
    const included = spec.include.some(g => matchGlob(rel, g))
    if (!included) continue
    const dest = path.join(spec.to, rel)
    ensureDir(path.dirname(dest))
    fs.copyFileSync(abs, dest)
    // node-pty's darwin spawn-helper and the Windows helper binaries
    // (OpenConsole.exe, winpty-agent.exe) are invoked via posix_spawn /
    // CreateProcess at runtime, so they must remain executable in the
    // staged tree.  fs.copyFileSync preserves source mode on POSIX, but we
    // re-assert +x defensively for the darwin spawn-helper (no extension
    // means a stripped mode would be silently broken at runtime).
    if (path.basename(rel) === 'spawn-helper' && process.platform !== 'win32') {
      try { fs.chmodSync(dest, 0o755) } catch { /* best-effort */ }
    }
    copied += 1
  }
  console.log(`[stage-native-deps] ${path.relative(APP_ROOT, spec.to)}: ${copied} files`)
}

// Resolve a package name to an on-disk directory by probing the search roots
// in order. Handles scoped names (@scope/pkg). Returns null if not found.
function findPackageDir(name, roots) {
  for (const root of roots) {
    const dir = path.join(root, ...name.split('/'))
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
  }
  return null
}

// Resolve a package plus its transitive prod-dependency closure to on-disk
// directories. Walks `dependencies` (production only -- dev/optional/peer are
// not needed at runtime) breadth-first. Returns the resolved name->dir map and
// any names that could not be located.
function collectDependencyClosure(rootName, roots) {
  const resolved = new Map()
  const missing = []
  const queue = [rootName]
  while (queue.length) {
    const name = queue.shift()
    if (resolved.has(name) || missing.includes(name)) continue
    const dir = findPackageDir(name, roots)
    if (!dir) {
      missing.push(name)
      continue
    }
    resolved.set(name, dir)
    let pkg
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    } catch {
      pkg = {}
    }
    for (const dep of Object.keys(pkg.dependencies || {})) {
      if (!resolved.has(dep)) queue.push(dep)
    }
  }
  return { resolved, missing }
}

// Copy a package + its whole dependency closure into the staged node_modules,
// flat. A missing dependency is fatal: it means the closure would fault at
// runtime in the packaged app, so fail the build loudly rather than ship a
// broken updater.
function stageModuleTree(rootName) {
  const { resolved, missing } = collectDependencyClosure(rootName, MODULE_SEARCH_ROOTS)
  if (missing.length) {
    throw new Error(
      `stage-native-deps: cannot resolve ${missing.join(', ')} for the ` +
        `${rootName} dependency tree.  Run \`npm install\` at the workspace root first.`
    )
  }
  let pkgCount = 0
  let fileCount = 0
  for (const [name, dir] of resolved) {
    const dest = path.join(STAGE_ROOT, 'node_modules', ...name.split('/'))
    ensureDir(dest)
    for (const abs of walk(dir)) {
      const rel = path.relative(dir, abs)
      // Skip any nested node_modules: the closure is staged flat, so a nested
      // copy would be dead weight and could ship a conflicting transitive
      // version that shadows the flat one.
      if (rel.split(path.sep).includes('node_modules')) continue
      const out = path.join(dest, rel)
      ensureDir(path.dirname(out))
      fs.copyFileSync(abs, out)
      fileCount += 1
    }
    pkgCount += 1
  }
  console.log(
    `[stage-native-deps] node_modules/${rootName} tree: ${pkgCount} packages, ${fileCount} files`
  )
}

function main() {
  rmrf(STAGE_ROOT)
  ensureDir(STAGE_ROOT)
  for (const spec of NATIVE_DEPS) {
    stageOne(spec)
  }
  for (const rootName of MODULE_TREES) {
    stageModuleTree(rootName)
  }
}

main()
