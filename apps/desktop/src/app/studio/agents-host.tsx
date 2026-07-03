import { useCallback, useEffect, useState } from 'react'

import { setMuapiKey } from './shims/axios'
import { resetStudioRoute, usePathname } from './shims/next-navigation'
import {
  type AgentDetails,
  AgentProfile,
  AgentStudio,
  type AgentUserContext,
  AiAgent,
  CreateAgentPage,
  EditAgentPage,
  getAgentDetails,
  getConversationHistory,
  getUserBalance,
  type StudioProps
} from './vendor'

// Which agents sub-page the memory-router is on. Upstream shipped these as
// separate Next.js pages; inside Basecamp the host switches on the shim's
// pathname instead. Edit/profile read their own ids via useParams, so only
// the chat view needs ids extracted here (to hydrate AiAgent, which does not
// self-fetch — upstream fetched agent details in a server component).
type AgentsRoute =
  | { view: 'home' }
  | { view: 'create' }
  | { view: 'edit' }
  | { view: 'profile' }
  | { view: 'chat'; agentId: string; conversationId?: string }

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function parseAgentsRoute(pathname: string): AgentsRoute {
  if (pathname === '/agents/create') {
    return { view: 'create' }
  }
  if (/^\/agents\/edit\/[^/]+$/.test(pathname)) {
    return { view: 'edit' }
  }
  if (/^\/agents\/[^/]+\/profile$/.test(pathname)) {
    return { view: 'profile' }
  }
  const chat = /^\/agents\/([^/]+)(?:\/([^/]+))?$/.exec(pathname)

  if (chat) {
    return {
      view: 'chat',
      agentId: decodeSegment(chat[1]),
      conversationId: chat[2] ? decodeSegment(chat[2]) : undefined
    }
  }

  return { view: 'home' }
}

interface ChatData {
  agentDetails: AgentDetails
  initialHistory: unknown
}

// Host for the vendored Agents studio: gallery (AgentStudio) plus the chat,
// create, edit and profile sub-pages, switched on the memory-router pathname.
export function AgentsHost({ apiKey }: StudioProps) {
  const pathname = usePathname()
  const route = parseAgentsRoute(pathname)

  useEffect(() => {
    setMuapiKey(apiKey)
  }, [apiKey])

  useEffect(() => {
    resetStudioRoute()
  }, [])

  // Parity with the upstream site's auth context: the agent pages take a
  // useUser() hook for the greeting/balance strip. Basecamp derives it from
  // the balance endpoint, the only account surface a bare key exposes.
  const [agentUser, setAgentUser] = useState<AgentUserContext>({ user: null, isAuthorized: false })

  useEffect(() => {
    if (!apiKey) {
      return
    }
    let cancelled = false

    void (async () => {
      try {
        const data = await getUserBalance(apiKey)

        if (cancelled) {
          return
        }
        const email = typeof data.email === 'string' ? data.email : ''
        const username = email.split('@')[0] || 'Studio User'

        setAgentUser({
          user: { username, name: username, email, profile_photo: null, balance: data.balance || 0 },
          isAuthorized: true
        })
      } catch (error) {
        console.error('Failed to fetch user data for Agents:', error)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [apiKey])

  const useUser = useCallback(() => agentUser, [agentUser])

  // Chat hydration: AiAgent renders from initialAgentDetails/initialHistory
  // and never fetches them itself, so load both before mounting it.
  const [chatData, setChatData] = useState<ChatData | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)
  const chatAgentId = route.view === 'chat' ? route.agentId : null
  const chatConversationId = route.view === 'chat' ? route.conversationId : undefined

  useEffect(() => {
    setChatData(null)
    setChatError(null)
    if (!chatAgentId || !apiKey) {
      return
    }
    let cancelled = false

    void (async () => {
      try {
        const agentDetails = await getAgentDetails(apiKey, chatAgentId)
        const initialHistory = chatConversationId
          ? await getConversationHistory(apiKey, chatAgentId, chatConversationId)
          : null

        if (!cancelled) {
          setChatData({ agentDetails, initialHistory })
        }
      } catch (error) {
        if (!cancelled) {
          setChatError(error instanceof Error ? error.message : 'Failed to load agent.')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [apiKey, chatAgentId, chatConversationId])

  if (route.view === 'create') {
    return <CreateAgentPage usedIn="studio" useUser={useUser} />
  }
  if (route.view === 'edit') {
    return <EditAgentPage usedIn="studio" useUser={useUser} />
  }
  if (route.view === 'profile') {
    return <AgentProfile usedIn="muapiapp" useUser={useUser} />
  }
  if (route.view === 'chat') {
    if (chatError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-[#06061a] text-white/40">
          <p className="text-xs font-bold uppercase tracking-widest">{chatError}</p>
          <button
            className="rounded-lg border border-white/10 px-4 py-2 text-[10px] text-white/40 transition-colors hover:text-white"
            onClick={resetStudioRoute}
            type="button"
          >
            Back to Agents
          </button>
        </div>
      )
    }
    if (!chatData) {
      return (
        <div className="flex h-full items-center justify-center bg-[#06061a]">
          <div className="size-10 animate-spin rounded-full border-2 border-white/5 border-t-[#8b80e8]" />
        </div>
      )
    }

    return (
      <AiAgent
        initialAgentDetails={chatData.agentDetails}
        initialHistory={chatData.initialHistory}
        key={`${chatAgentId ?? ''}:${chatConversationId ?? ''}`}
        usedIn="muapiapp"
        useUser={useUser}
      />
    )
  }

  return <AgentStudio apiKey={apiKey} />
}
