#!/usr/bin/env node
// merge-mac-latest.mjs
//
// Rewrites release/latest-mac.yml so it lists BOTH the arm64 and x64 macOS
// artifacts. electron-builder emits a single-arch latest-mac.yml (whichever
// arch was built last overwrites it), which leaves Intel Macs unable to
// auto-update. electron-updater 6.x picks the correct file per architecture
// via MacUpdater.filterFilesForArch (arm64 Macs keep arm64 files, x64 Macs
// drop arm64 files), so listing both arch zips in one manifest is the
// supported multi-arch path and does not disturb the arm64 channel.
//
// Usage:
//   node scripts/merge-mac-latest.mjs [releaseDir]
//   node scripts/merge-mac-latest.mjs --check <file.zip> <expectedBase64Sha512>
//
// Requires both arch zips to already exist in releaseDir. Build them with:
//   npm run dist:mac                    # arm64 (host)
//   npm run builder -- --mac --x64      # x64 (cross-built from arm64 host)
// then run this script before uploading the release.

import { createHash } from 'node:crypto'
import { readFileSync, existsSync, writeFileSync, statSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'

const ARM64 = 'arm64'
const X64 = 'x64'

// electron-builder records sha512 as the base64 of the raw SHA-512 digest.
export function sha512Base64(filePath) {
  return createHash('sha512').update(readFileSync(filePath)).digest('base64')
}

export function fileEntry(dir, name) {
  const full = join(dir, name)
  return {
    url: name,
    sha512: sha512Base64(full),
    size: statSync(full).size,
  }
}

// Serialize one files[] entry as electron-builder does (2-space indent).
function serializeEntry(e) {
  return `  - url: ${e.url}\n    sha512: ${e.sha512}\n    size: ${e.size}`
}

export function buildManifest({ version, files, releaseDate }) {
  // Primary (top-level path/sha512) points at the arm64 zip for backward
  // compatibility with pre-6.x clients; modern clients read files[] + arch.
  const primary = files.find((f) => f.url.endsWith('.zip') && f.url.includes(ARM64)) || files[0]
  const lines = [
    `version: ${version}`,
    'files:',
    ...files.map(serializeEntry),
    `path: ${primary.url}`,
    `sha512: ${primary.sha512}`,
    `releaseDate: '${releaseDate}'`,
  ]
  return lines.join('\n') + '\n'
}

function pick(names, arch, ext) {
  return names.find((n) => n.endsWith(ext) && n.includes(`-mac-${arch}.`))
}

function main() {
  const argv = process.argv.slice(2)

  if (argv[0] === '--check') {
    const [, file, expected] = argv
    const got = sha512Base64(file)
    if (got === expected) {
      console.log(`[merge-mac-latest] OK ${basename(file)} sha512 matches`)
      process.exit(0)
    }
    console.error(`[merge-mac-latest] MISMATCH ${basename(file)}\n  expected: ${expected}\n  got:      ${got}`)
    process.exit(1)
  }

  const dir = argv[0] || join(process.cwd(), 'release')
  const yml = join(dir, 'latest-mac.yml')
  if (!existsSync(dir)) {
    console.error(`[merge-mac-latest] release dir not found: ${dir}`)
    process.exit(1)
  }

  const names = readdirSync(dir)
  const armZip = pick(names, ARM64, '.zip')
  const x64Zip = pick(names, X64, '.zip')
  if (!armZip || !x64Zip) {
    console.error(
      `[merge-mac-latest] need both arch zips in ${dir}\n  arm64 zip: ${armZip || 'MISSING'}\n  x64 zip:   ${x64Zip || 'MISSING'}\n` +
        `Build both arches first (npm run dist:mac && npm run builder -- --mac --x64).`,
    )
    process.exit(1)
  }

  // Order mirrors electron-builder: zip then dmg, arm64 group then x64 group.
  const wanted = [
    armZip,
    pick(names, ARM64, '.dmg'),
    x64Zip,
    pick(names, X64, '.dmg'),
  ].filter(Boolean)
  const files = wanted.map((n) => fileEntry(dir, n))

  // Preserve version + releaseDate from the existing single-arch manifest.
  let version = process.env.npm_package_version
  let releaseDate = new Date().toISOString()
  if (existsSync(yml)) {
    const prev = readFileSync(yml, 'utf8')
    const v = prev.match(/^version:\s*(.+)$/m)
    const d = prev.match(/^releaseDate:\s*'?([^'\n]+)'?$/m)
    if (v) version = v[1].trim()
    if (d) releaseDate = d[1].trim()
  }
  if (!version) {
    console.error('[merge-mac-latest] no version (no existing yml, no npm_package_version)')
    process.exit(1)
  }

  const out = buildManifest({ version, files, releaseDate })
  writeFileSync(yml, out)
  console.log(`[merge-mac-latest] wrote ${yml} with ${files.length} files:`)
  for (const f of files) console.log(`  - ${f.url} (${f.size} bytes)`)
}

// Only run main when invoked directly (allows importing helpers in tests).
// Use pathToFileURL so paths containing spaces/special chars compare correctly.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
