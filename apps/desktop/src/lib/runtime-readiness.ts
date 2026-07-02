import { isProviderSetupErrorMessage } from './provider-setup-errors'

export interface SetupStatusSnapshot {
  provider_configured?: boolean
}

export interface RuntimeCheckSnapshot {
  error?: string
  ok?: boolean
}

export interface RuntimeReadinessSignals {
  setup: null | SetupStatusSnapshot
  setupError: null | string
  runtime: null | RuntimeCheckSnapshot
  runtimeError: null | string
}

export interface RuntimeReadinessOptions {
  defaultReason?: string
  unknownReady?: boolean
}

export interface RuntimeReadinessResult {
  checksDisagree: boolean
  ready: boolean
  reason: null | string
  source: 'fallback' | 'runtime_check' | 'setup_status'
}

export type RuntimeReadinessRequester = <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>

const DEFAULT_NOT_READY_REASON = 'Add a provider credential before sending your first message.'

// Shown when setup.status counts stored credentials but the runtime can't
// resolve any of them into a usable provider (dead keys, revoked tokens,
// credentials auto-harvested from ambient env vars).
export const SAVED_CREDENTIALS_UNUSABLE_REASON =
  'Basecamp found saved credentials on this device, but none of them can run a model right now. Connect a provider to continue.'

const SAVED_CREDENTIALS_MISMATCH_SUFFIX =
  'Saved credentials were found, but none of them can run a model right now.'

// Backend failure strings can be raw CLI guidance ("Run 'hermes model'...",
// "set an API key ... in ~/.hermes/.env") that means nothing inside the
// desktop app. Drop those so callers fall back to desktop-appropriate copy.
function humanizeFailure(message: null | string): null | string {
  if (message && isProviderSetupErrorMessage(message)) {
    return null
  }

  return message
}

function toErrorMessage(error: unknown): null | string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  if (error === null || error === undefined) {
    return null
  }

  return String(error)
}

function normalizeMessage(value: null | string | undefined): null | string {
  const next = value?.trim()

  return next ? next : null
}

async function requestWithFallback<T>(
  requestGateway: RuntimeReadinessRequester,
  method: string
): Promise<{ error: null | string; value: null | T }> {
  try {
    return { error: null, value: await requestGateway<T>(method) }
  } catch (error) {
    return { error: toErrorMessage(error), value: null }
  }
}

export async function fetchRuntimeReadinessSignals(
  requestGateway: RuntimeReadinessRequester
): Promise<RuntimeReadinessSignals> {
  const [setup, runtime] = await Promise.all([
    requestWithFallback<SetupStatusSnapshot>(requestGateway, 'setup.status'),
    requestWithFallback<RuntimeCheckSnapshot>(requestGateway, 'setup.runtime_check')
  ])

  return {
    setup: setup.value,
    setupError: setup.error,
    runtime: runtime.value,
    runtimeError: runtime.error
  }
}

export function interpretRuntimeReadiness(
  signals: RuntimeReadinessSignals,
  options: RuntimeReadinessOptions = {}
): RuntimeReadinessResult {
  const defaultReason = options.defaultReason ?? DEFAULT_NOT_READY_REASON
  const unknownReady = options.unknownReady ?? false

  const setupConfigured =
    typeof signals.setup?.provider_configured === 'boolean' ? Boolean(signals.setup.provider_configured) : undefined

  const runtimeOk = typeof signals.runtime?.ok === 'boolean' ? Boolean(signals.runtime.ok) : undefined
  const runtimeFailure = humanizeFailure(normalizeMessage(signals.runtime?.error) ?? normalizeMessage(signals.runtimeError))
  const setupFailure = humanizeFailure(normalizeMessage(signals.setupError))

  const checksDisagree =
    typeof setupConfigured === 'boolean' && typeof runtimeOk === 'boolean' && setupConfigured !== runtimeOk

  if (typeof runtimeOk === 'boolean') {
    if (runtimeOk) {
      return {
        checksDisagree,
        ready: true,
        reason: null,
        source: 'runtime_check'
      }
    }

    let reason = runtimeFailure ?? defaultReason

    if (checksDisagree && setupConfigured) {
      reason = runtimeFailure
        ? `${runtimeFailure} ${SAVED_CREDENTIALS_MISMATCH_SUFFIX}`
        : SAVED_CREDENTIALS_UNUSABLE_REASON
    }

    return {
      checksDisagree,
      ready: false,
      reason,
      source: 'runtime_check'
    }
  }

  if (typeof setupConfigured === 'boolean') {
    return {
      checksDisagree: false,
      ready: setupConfigured,
      reason: setupConfigured ? null : (runtimeFailure ?? setupFailure ?? defaultReason),
      source: 'setup_status'
    }
  }

  return {
    checksDisagree: false,
    ready: unknownReady,
    reason: unknownReady ? null : (runtimeFailure ?? setupFailure ?? defaultReason),
    source: 'fallback'
  }
}

export async function evaluateRuntimeReadiness(
  requestGateway: RuntimeReadinessRequester,
  options: RuntimeReadinessOptions = {}
): Promise<RuntimeReadinessResult> {
  const signals = await fetchRuntimeReadinessSignals(requestGateway)

  return interpretRuntimeReadiness(signals, options)
}
