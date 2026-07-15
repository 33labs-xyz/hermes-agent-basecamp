'use strict'

// Deciding when a packaged shell has out-run its Python backend.
//
// The Electron shell auto-updates itself from GitHub Releases on launch, but
// the Hermes backend under ~/.basecamp only moves when a bootstrap run fires.
// isBootstrapComplete() deliberately treats "marker + venv + checkout exist" as
// good enough and never checks WHICH commit the checkout sits at -- so a
// shell-only auto-update leaves an existing tester frozen on the old backend
// (e.g. missing the Composio catalog added in a later commit).
//
// This pure predicate closes that gap: when the shell's build stamp
// (INSTALL_STAMP.commit -- the exact SHA the .app/.exe was built and tested at)
// differs from the commit the bootstrap marker was last pinned to, the backend
// is stale and the launch path re-runs the (already tested) bootstrap to sync
// the checkout forward. The bootstrap rewrites the marker to the new commit, so
// the next launch converges and does not loop.
//
// Fail-safe by construction: if EITHER side is missing or too short to trust
// (dev/unpackaged runs have no stamp; a legacy marker may predate pinnedCommit)
// we return false -- never force a re-sync we cannot justify. A forced re-sync
// is only ever triggered by two trustworthy, differing SHAs.

const MIN_COMMIT_LENGTH = 7

function isValidCommit(value) {
  return typeof value === 'string' && value.length >= MIN_COMMIT_LENGTH
}

function isBackendStale({ installStamp, marker } = {}) {
  const shellCommit = installStamp && installStamp.commit
  const backendCommit = marker && marker.pinnedCommit

  if (!isValidCommit(shellCommit) || !isValidCommit(backendCommit)) {
    return false
  }

  return shellCommit !== backendCommit
}

module.exports = { isBackendStale }
