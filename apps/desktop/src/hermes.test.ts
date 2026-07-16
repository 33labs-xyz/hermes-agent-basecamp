import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { queryClient } from '@/lib/query-client'

import { createSkill, deleteEnvVar, getSessionMessages, listAllProfileSessions, listSessions, setApiRequestProfile, setEnvVar, transcribeAudio } from './hermes'

vi.mock('@/lib/query-client', () => ({ queryClient: { invalidateQueries: vi.fn() } }))

const emptySessionsResponse = {
  limit: 0,
  offset: 0,
  sessions: [],
  total: 0
}

describe('Hermes REST session helpers', () => {
  let api: ReturnType<typeof vi.fn>

  beforeEach(() => {
    api = vi.fn().mockResolvedValue(emptySessionsResponse)
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { api }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, 'hermesDesktop')
  })

  it('uses a longer timeout for the single-profile session list', async () => {
    await listSessions(50, 1)

    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/sessions?limit=50&offset=0&min_messages=1&archived=exclude&order=recent',
        timeoutMs: 60_000
      })
    )
  })

  it('uses a longer timeout for the all-profile session list', async () => {
    await listAllProfileSessions(50, 1)

    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/profiles/sessions?limit=50&offset=0&min_messages=1&archived=exclude&order=recent&profile=all',
        timeoutMs: 60_000
      })
    )
  })

  it('tags cross-profile message reads for Electron routing and backend lookup', async () => {
    api.mockResolvedValue({ messages: [], session_id: 'session-1' })

    await getSessionMessages('session-1', 'xiaoxuxu')

    expect(api).toHaveBeenCalledWith({
      path: '/api/sessions/session-1/messages?profile=xiaoxuxu',
      profile: 'xiaoxuxu'
    })
  })
})

describe('createSkill', () => {
  let api: ReturnType<typeof vi.fn>

  beforeEach(() => {
    api = vi.fn().mockResolvedValue({ message: 'ok', path: '/x/SKILL.md', skill_md: '---', success: true })
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { api }
    })
  })

  afterEach(() => {
    setApiRequestProfile(null)
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, 'hermesDesktop')
  })

  it('POSTs name + content to /api/skills', async () => {
    await createSkill('my-skill', '---\nname: my-skill\n---\n\nDo the thing.')

    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { content: '---\nname: my-skill\n---\n\nDo the thing.', name: 'my-skill' },
        method: 'POST',
        path: '/api/skills'
      })
    )
  })

  it('includes category when provided', async () => {
    await createSkill('my-skill', 'body', 'writing')

    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({ body: { category: 'writing', content: 'body', name: 'my-skill' } })
    )
  })

  // The active profile must ride at the descriptor top level (so the desktop
  // routes to that profile's own backend), NEVER inside the body. Moving it
  // into the body would 404 a per-profile-remote-override backend, whose remote
  // host has no profile by that name. This locks the integration contract.
  it('rides the active profile at the descriptor top level, never in the body', async () => {
    setApiRequestProfile('xiaoxuxu')

    await createSkill('my-skill', 'body', 'writing')

    expect(api).toHaveBeenCalledWith({
      body: { category: 'writing', content: 'body', name: 'my-skill' },
      method: 'POST',
      path: '/api/skills',
      profile: 'xiaoxuxu'
    })
  })
})

describe('env var writes bust the env-vars cache', () => {
  let api: ReturnType<typeof vi.fn>

  beforeEach(() => {
    api = vi.fn().mockResolvedValue({ ok: true })
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { api }
    })
    vi.mocked(queryClient.invalidateQueries).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, 'hermesDesktop')
  })

  // A saved provider key must immediately reach the model picker's env gate.
  // The picker, the titlebar balances chip and the model menu all read the
  // ['env-vars'] query and nothing else invalidates it, so the write path must.
  // Otherwise a stale is_set:false startup snapshot hides the just-connected
  // provider and the onboarding picker renders "No models found."
  it('invalidates the env-vars query after setEnvVar resolves', async () => {
    await setEnvVar('OPENROUTER_API_KEY', 'sk-or-v1-test')

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['env-vars'] })
  })

  it('invalidates the env-vars query after deleteEnvVar resolves', async () => {
    await deleteEnvVar('OPENROUTER_API_KEY')

    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['env-vars'] })
  })
})

describe('transcribeAudio', () => {
  let api: ReturnType<typeof vi.fn>

  beforeEach(() => {
    api = vi.fn().mockResolvedValue({ transcript: 'hello' })
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { api }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, 'hermesDesktop')
  })

  // Voice transcription runs on-device (local faster-whisper, no API key). On a
  // machine's FIRST run the backend lazy-installs faster-whisper, downloads a
  // ~150MB model, then does CPU inference - all inside one HTTP request that
  // far outlasts the 15s default Electron proxy timeout. That timeout aborts
  // the request with "Timed out connecting to Basecamp backend after 15000ms",
  // which surfaces as "Voice transcription failed" even though nothing is
  // wrong. A generous per-request timeout lets the first-run install finish.
  it('passes a generous timeout so first-run local Whisper is not aborted', async () => {
    await transcribeAudio('data:audio/webm;base64,AAAA', 'audio/webm')

    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/api/audio/transcribe',
        method: 'POST',
        body: { data_url: 'data:audio/webm;base64,AAAA', mime_type: 'audio/webm' },
        timeoutMs: 180_000
      })
    )
  })
})
