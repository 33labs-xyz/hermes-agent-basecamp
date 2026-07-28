# Releasing Basecamp to testers

Testers download a packaged build, run it, and later get a "Restart Now to
update" prompt automatically. That works through **electron-updater** pointed at
**GitHub Releases** on the public repo `33labs-xyz/hermes-agent-basecamp`.

## One-time setup

### GitHub token (publishing the release)
electron-builder uploads the build to a GitHub release. It needs a token with
`repo` scope, in the env at build time:

```bash
export GH_TOKEN=ghp_xxx   # classic PAT with repo scope (or fine-grained: Contents read/write)
```

### Apple signing + notarization (Mac only)
Mac auto-update REQUIRES a signed + notarized build. Without it, Mac auto-update
silently fails and macOS shows an "unidentified developer" warning. The build is
already wired for it (`build.mac.hardenedRuntime`, `afterSign: scripts/notarize.cjs`).
Supply the credentials in the env:

```bash
export APPLE_ID="you@example.com"            # Apple Developer account email
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # appleid.apple.com -> App-Specific Passwords
export APPLE_TEAM_ID="XXXXXXXXXX"            # Apple Developer -> Membership -> Team ID
# Developer ID Application cert must be installed in the login keychain
# (Xcode -> Settings -> Accounts -> Manage Certificates, or import the .p12).
```

Windows ships unsigned for now (testers click past one SmartScreen warning).

## Cutting a release

1. Bump the version (testers only see an update if the version is higher):

   ```bash
   cd apps/desktop
   npm version patch --no-git-tag-version   # or edit "version" in package.json
   ```

2. Build + publish:

   ```bash
   # Mac (run on a Mac with the Apple creds above exported):
   GH_TOKEN=... npm run dist:mac -- --publish always

   # Windows (run on Windows, or a Windows CI runner):
   set GH_TOKEN=...
   npm run dist:win -- --publish always
   ```

   `--publish always` uploads the installers AND the `latest-mac.yml` /
   `latest.yml` metadata files that electron-updater reads. Both OS builds
   publish to the same GitHub release for that version.

   ### Intel (x64) Macs — multi-arch auto-update

   The primary Mac build is arm64 (Apple Silicon). Intel Macs can install the
   x64 dmg fine, but they can only **auto-update** if `latest-mac.yml` lists an
   x64 artifact too. electron-builder emits a *single-arch* `latest-mac.yml`
   (whichever arch built last overwrites it), so an arm64-only build leaves
   Intel testers stuck. electron-updater picks the correct file per architecture
   (`MacUpdater.filterFilesForArch` — arm64 Macs keep arm64 files, x64 Macs drop
   them), so a combined manifest is safe for both.

   To ship both arches, build x64 as a cross-build from the arm64 host, then
   merge the manifests **without** `--publish` (so electron-builder's single-arch
   `latest-mac.yml` doesn't clobber the combined one), and upload manually:

   ```bash
   # arm64 (host) + x64 (cross) + combined latest-mac.yml, all in release/
   npm run dist:mac:multiarch
   # -> release/ now has -mac-arm64.{zip,dmg}, -mac-x64.{zip,dmg}, and a
   #    latest-mac.yml listing BOTH arch zips (arm64 stays the primary path:).
   # Then upload every release/*-mac-*.{zip,dmg} + latest-mac.yml to the GitHub
   # release with `gh release upload` (one-shot alongside the Windows assets).
   ```

   `merge:mac:latest` regenerates `release/latest-mac.yml` from whatever
   `-mac-*.zip`/`-mac-*.dmg` files are present, recomputing each `sha512`
   (base64 of the raw SHA-512 digest) + byte size and preserving the existing
   `version` + `releaseDate`. Run `scripts/merge-mac-latest.mjs --check <zip>
   <expected-sha512>` to sanity-check the hash algorithm against a known-good
   entry. Covered by `scripts/merge-mac-latest.test.mjs` (`node --test`).

3. The GitHub release can stay a draft while you test, then **Publish** it. Once
   published, every installed tester app notices on next launch (or via
   "Check for Updates" in the menu) and offers Restart Now.

## Download page

`release-page/index.html` is the tester landing page (deploy to
`basecamp-testers-dl.netlify.app`). It reads the latest release from the public
repo and wires Mac/Windows buttons to the right asset automatically, so it needs
no edits per release.

## Notes

- Dev runs from source are unaffected: the updater is gated on `app.isPackaged`,
  so `Check for Updates` in a source build still uses the git-rebuild flow.
- mac target must include `zip` and win must include `nsis` (both already set) -
  electron-updater needs those formats to apply updates.
