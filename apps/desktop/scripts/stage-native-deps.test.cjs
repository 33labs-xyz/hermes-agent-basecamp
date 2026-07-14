'use strict'

/**
 * Tests that scripts/stage-native-deps.cjs stages the electron-updater runtime
 * dependency tree into build/native-deps/node_modules/ for packaged auto-update.
 *
 * Why this matters: build.files whitelists electron/** + dist/** and excludes
 * node_modules, so electron-updater (like node-pty) is absent from a packaged
 * build unless we stage it into extraResources. Without it, auto-updater.cjs's
 * require('electron-updater') throws in the asar and every update path silently
 * no-ops -- packaged testers can never auto-update. This guards the staging that
 * fixes that, and the flat-closure completeness that keeps a require() inside
 * electron-updater from faulting at runtime.
 *
 * Run with: node --test scripts/stage-native-deps.test.cjs
 */

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const APP_ROOT = path.resolve(__dirname, '..')
const STAGE_ROOT = path.join(APP_ROOT, 'build', 'native-deps')
const STAGED_MODULES = path.join(STAGE_ROOT, 'node_modules')
const STAGE_SCRIPT = path.join(APP_ROOT, 'scripts', 'stage-native-deps.cjs')

// Run the real staging step once, up front. It rm-rf's and rebuilds
// build/native-deps exactly as `npm run build` does, so the assertions below
// observe the same tree a packaged build would ship.
test('stage-native-deps runs and stages electron-updater with runnable entry code', () => {
  execFileSync(process.execPath, [STAGE_SCRIPT], { cwd: APP_ROOT, stdio: 'pipe' })

  const updaterDir = path.join(STAGED_MODULES, 'electron-updater')
  const updaterPkgPath = path.join(updaterDir, 'package.json')
  assert.ok(fs.existsSync(updaterPkgPath), 'electron-updater/package.json is staged')

  // Prove the wholesale copy includes the runtime entry code, not just the
  // manifest -- a require() must resolve to real JS.
  const updaterPkg = JSON.parse(fs.readFileSync(updaterPkgPath, 'utf8'))
  const mainRel = updaterPkg.main || 'index.js'
  assert.ok(
    fs.existsSync(path.join(updaterDir, mainRel)),
    `electron-updater main entry (${mainRel}) is staged`
  )
})

test('stage-native-deps stages a representative slice of the transitive tree', () => {
  // If tree resolution regresses to "electron-updater only", these disappear.
  for (const dep of ['builder-util-runtime', 'js-yaml', 'semver', 'lodash.isequal']) {
    assert.ok(
      fs.existsSync(path.join(STAGED_MODULES, dep, 'package.json')),
      `${dep} (an electron-updater dependency) is staged`
    )
  }
})

test('staged tree has no missing transitive prod dependencies', () => {
  // Every prod dependency named anywhere in the staged tree must itself be
  // present -- otherwise a require() inside electron-updater faults at runtime
  // in the packaged app, which is exactly the class of bug this staging fixes.
  const names = fs
    .readdirSync(STAGED_MODULES, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
  const staged = new Set(names)

  for (const name of names) {
    const pkgPath = path.join(STAGED_MODULES, name, 'package.json')
    if (!fs.existsSync(pkgPath)) continue
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    for (const dep of Object.keys(pkg.dependencies || {})) {
      assert.ok(staged.has(dep), `dependency ${dep} (of ${name}) is present in the staged tree`)
    }
  }
})
