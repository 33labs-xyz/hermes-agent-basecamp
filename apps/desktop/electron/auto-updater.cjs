// Real tester auto-update via electron-updater + GitHub Releases.
//
// This is the path for people who DOWNLOAD a packaged Basecamp build (no repo,
// no git, no toolchain). It is gated on app.isPackaged so a developer running
// from source keeps the existing git-rebuild update flow in main.cjs untouched.
//
// Flow: on launch (and on manual "Check for Updates") electron-updater asks the
// GitHub Releases feed "is there a newer version?". If yes it downloads in the
// background, then a native dialog offers "Restart Now" -> quitAndInstall().

const { app, dialog } = require('electron')

let autoUpdater = null
let initialized = false
let getWindow = () => null
let manualCheckInFlight = false

function loadUpdater() {
  if (autoUpdater) return autoUpdater
  try {
    autoUpdater = require('electron-updater').autoUpdater
  } catch {
    autoUpdater = null
  }
  return autoUpdater
}

function activeWindow() {
  const win = getWindow()
  if (!win || win.isDestroyed()) return null
  return win
}

function notifyRenderer(payload) {
  const win = activeWindow()
  if (!win) return
  const wc = win.webContents
  if (!wc || wc.isDestroyed()) return
  wc.send('hermes:auto-update', payload)
}

function showDialog(opts) {
  const win = activeWindow()
  return win ? dialog.showMessageBoxSync(win, opts) : dialog.showMessageBoxSync(opts)
}

function promptInstall(info) {
  const version = info && info.version ? info.version : ''
  const detail = version
    ? `Basecamp ${version} has been downloaded. Restart now to update.`
    : 'An update has been downloaded. Restart now to update.'
  const choice = showDialog({
    type: 'info',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update Ready',
    message: 'Update ready to install',
    detail
  })
  if (choice === 0) {
    const updater = loadUpdater()
    if (updater) setImmediate(() => updater.quitAndInstall())
  }
}

// Wire the electron-updater lifecycle once. windowGetter must return the main
// BrowserWindow (or null) so progress/prompts target a live window.
function initAutoUpdater(windowGetter) {
  if (typeof windowGetter === 'function') getWindow = windowGetter
  if (initialized) return
  if (!app.isPackaged) return // dev build: leave the git flow alone
  const updater = loadUpdater()
  if (!updater) return
  initialized = true

  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true

  updater.on('checking-for-update', () => notifyRenderer({ stage: 'checking' }))
  updater.on('update-available', info => notifyRenderer({ stage: 'available', version: info && info.version }))
  updater.on('update-not-available', () => notifyRenderer({ stage: 'none' }))
  updater.on('download-progress', p => notifyRenderer({ stage: 'downloading', percent: p && p.percent }))
  updater.on('error', err => notifyRenderer({ stage: 'error', message: err && err.message }))
  updater.on('update-downloaded', info => {
    notifyRenderer({ stage: 'downloaded', version: info && info.version })
    promptInstall(info)
  })

  // Silent check shortly after launch so testers get prompted without clicking.
  updater.checkForUpdates().catch(() => {})
}

// Manual "Check for Updates" menu action. Surfaces an explicit "up to date"
// dialog when there is nothing new; otherwise autoDownload + the downloaded
// handler take over and prompt for restart.
async function checkForUpdatesManual() {
  if (!app.isPackaged) return { ok: false, reason: 'dev' }
  const updater = loadUpdater()
  if (!updater) return { ok: false, reason: 'unavailable' }
  if (manualCheckInFlight) return { ok: true, inFlight: true }
  manualCheckInFlight = true
  try {
    const result = await updater.checkForUpdates()
    const current = app.getVersion()
    const latest = result && result.updateInfo && result.updateInfo.version
    if (!latest || latest === current) {
      showDialog({
        type: 'info',
        buttons: ['OK'],
        title: 'No Updates',
        message: 'You are up to date',
        detail: `Basecamp ${current} is the latest version.`
      })
    }
    return { ok: true, current, latest }
  } catch (err) {
    showDialog({
      type: 'warning',
      buttons: ['OK'],
      title: 'Update Check Failed',
      message: 'Could not check for updates',
      detail: (err && err.message) || 'Unknown error.'
    })
    return { ok: false, reason: 'error', message: err && err.message }
  } finally {
    manualCheckInFlight = false
  }
}

module.exports = { initAutoUpdater, checkForUpdatesManual }
