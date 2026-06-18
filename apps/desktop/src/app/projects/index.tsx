import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  addKnowledgeFile,
  type ChatGroup,
  type ChatKnowledgeFile,
  deleteKnowledgeFile,
  listKnowledgeFiles,
  type SessionInfo
} from '@/hermes'
import { useI18n } from '@/i18n'
import { ChevronLeft, FileText, FolderOpen, Plus, Save, Trash2 } from '@/lib/icons'
import { notify, notifyError } from '@/store/notifications'
import { $projects, $projectsLoading, setPendingProjectForNewChat, updateProject } from '@/store/projects'
import { $cronSessions, $sessions } from '@/store/session'

import { PageSearchShell } from '../page-search-shell'
import { NEW_CHAT_ROUTE, sessionRoute } from '../routes'
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

// Mirror the backend per-file content cap (_FILE_CONTENT_MAX). Validate here so
// an oversized paste/upload fails fast with a friendly message instead of a 4xx.
const KNOWLEDGE_CONTENT_MAX = 200_000
// Fallback name for pasted text when the user leaves the name field blank.
const PASTED_KNOWLEDGE_NAME = 'note.md'

interface ProjectsViewProps extends React.ComponentProps<'section'> {
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

export function ProjectsView({ setStatusbarItemGroup: _setStatusbarItemGroup, ...props }: ProjectsViewProps) {
  const { t } = useI18n()
  const p = t.sidebar.projects.page
  const navigate = useNavigate()
  const { groupId = '' } = useParams<{ groupId: string }>()
  const projects = useStore($projects)
  const loading = useStore($projectsLoading)
  const project = useMemo(() => projects.find(group => group.id === groupId) ?? null, [projects, groupId])

  // Still resolving the project list on a cold open — wait before deciding the
  // id is bad, so a deep link doesn't flash "not found" before projects load.
  const stillLoading = loading && projects.length === 0

  const header = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Button aria-label={p.back} onClick={() => navigate(NEW_CHAT_ROUTE)} size="icon-xs" variant="ghost">
        <ChevronLeft className="size-4" />
      </Button>
      <FolderOpen className="size-4 shrink-0 text-(--ui-text-tertiary)" />
      <h2 className="min-w-0 truncate text-[0.9375rem] font-semibold tracking-tight">
        {project ? project.name : p.notFound}
      </h2>
      {project && (
        <Button className="ml-auto" onClick={() => startNewChat(project.id, navigate)} size="sm" variant="textStrong">
          <Plus className="size-3.5" />
          {p.newChat}
        </Button>
      )}
    </div>
  )

  return (
    <PageSearchShell
      {...props}
      onSearchChange={() => {}}
      searchHidden
      searchPlaceholder=""
      searchValue=""
      tabs={header}
    >
      {project ? (
        <ProjectDetail key={project.id} project={project} />
      ) : stillLoading ? (
        <PageLoader label={p.openProject} />
      ) : (
        <div className="grid h-full place-items-center px-6 text-center text-sm text-(--ui-text-tertiary)">
          {p.notFound}
        </div>
      )}
    </PageSearchShell>
  )
}

function ProjectDetail({ project }: { project: ChatGroup }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 px-5 py-5">
        {project.description.trim() && (
          <p className="text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
            {project.description}
          </p>
        )}

        <InstructionsSection project={project} />
        <KnowledgeSection project={project} />
        <RecentChatsSection project={project} />
      </div>
    </div>
  )
}

// Arm the one-shot project assignment, then open a blank chat. The next backend
// session created for a send consumes the arm and lands in this project.
function startNewChat(projectId: string, navigate: (to: string) => void) {
  setPendingProjectForNewChat(projectId)
  navigate(NEW_CHAT_ROUTE)
}

function InstructionsSection({ project }: { project: ChatGroup }) {
  const { t } = useI18n()
  const p = t.sidebar.projects.page
  const [value, setValue] = useState(project.instructions)
  const [saving, setSaving] = useState(false)
  const dirty = value !== project.instructions

  async function save() {
    if (saving || !dirty) {
      return
    }

    setSaving(true)

    try {
      await updateProject(project.id, { instructions: value })
      notify({ durationMs: 2_000, kind: 'success', message: p.instructionsSaved })
    } catch (err) {
      notifyError(err, p.instructionsSaveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <SectionTitle>{p.instructionsTitle}</SectionTitle>
      <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {p.instructionsHint}
      </p>
      <Textarea
        className="mt-3 min-h-28"
        onChange={event => setValue(event.target.value)}
        placeholder={p.instructionsHint}
        value={value}
      />
      <div className="mt-2 flex justify-end">
        <Button disabled={!dirty || saving} onClick={() => void save()} size="sm">
          <Save className="size-3.5" />
          {saving ? p.saving : p.save}
        </Button>
      </div>
    </section>
  )
}

function KnowledgeSection({ project }: { project: ChatGroup }) {
  const { t } = useI18n()
  const p = t.sidebar.projects.page
  const [files, setFiles] = useState<ChatKnowledgeFile[] | null>(null)
  const [name, setName] = useState('')
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false

    listKnowledgeFiles(project.id)
      .then(loaded => {
        if (!cancelled) {
          setFiles(loaded)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setFiles([])
          notifyError(err, p.knowledgeLoadFailed)
        }
      })

    return () => {
      cancelled = true
    }
  }, [project.id, p.knowledgeLoadFailed])

  async function add(content: string, fileName: string, contentType?: string) {
    if (content.length > KNOWLEDGE_CONTENT_MAX) {
      notify({ durationMs: 3_000, kind: 'error', message: p.fileTooLarge })

      return
    }

    setBusy(true)

    try {
      const created = await addKnowledgeFile(project.id, { content, content_type: contentType, name: fileName })
      setFiles(current => [...(current ?? []), created])
      setPaste('')
      setName('')
      notify({ durationMs: 2_000, kind: 'success', message: p.knowledgeAdded })
    } catch (err) {
      notifyError(err, p.knowledgeAddFailed)
    } finally {
      setBusy(false)
    }
  }

  async function addPasted() {
    const content = paste.trim()

    if (!content) {
      return
    }

    await add(content, name.trim() || PASTED_KNOWLEDGE_NAME)
  }

  async function onFilePicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset so re-picking the same file fires onChange again.
    event.target.value = ''

    if (!file) {
      return
    }

    const text = await file.text()
    await add(text, file.name, file.type || 'text/plain')
  }

  async function remove(fileId: string) {
    try {
      await deleteKnowledgeFile(project.id, fileId)
      setFiles(current => (current ?? []).filter(file => file.id !== fileId))
      notify({ durationMs: 2_000, kind: 'success', message: p.knowledgeDeleted })
    } catch (err) {
      notifyError(err, p.knowledgeDeleteFailed)
    }
  }

  return (
    <section>
      <SectionTitle>{p.knowledgeTitle}</SectionTitle>
      <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {p.knowledgeHint}
      </p>

      <div className="mt-3 grid gap-1">
        {files === null ? (
          <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">…</p>
        ) : files.length === 0 ? (
          <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
            {p.knowledgeEmpty}
          </p>
        ) : (
          files.map(file => (
            <div
              className="flex items-center gap-2 rounded-md border border-(--ui-divider) px-3 py-2"
              key={file.id}
            >
              <FileText className="size-4 shrink-0 text-(--ui-text-tertiary)" />
              <span className="min-w-0 flex-1 truncate text-[0.8125rem]">{file.name}</span>
              <span className="shrink-0 text-[0.66rem] text-(--ui-text-tertiary) tabular-nums">
                {p.fileBytes(file.size)}
              </span>
              <Button
                aria-label={p.removeFile}
                className="size-7 shrink-0"
                onClick={() => void remove(file.id)}
                size="icon"
                title={p.removeFile}
                variant="ghost"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 space-y-2 rounded-lg border border-(--ui-divider) p-3">
        <div className="flex items-center gap-2">
          <Input
            aria-label={p.fileNameLabel}
            onChange={event => setName(event.target.value)}
            placeholder={p.fileNamePlaceholder}
            value={name}
          />
          <Button disabled={busy} onClick={() => fileInputRef.current?.click()} size="sm" variant="textStrong">
            {p.addFile}
          </Button>
          <input
            accept=".txt,.md,.markdown,.mdx,.text,text/*"
            className="hidden"
            onChange={event => void onFilePicked(event)}
            ref={fileInputRef}
            type="file"
          />
        </div>
        <Textarea
          aria-label={p.pasteLabel}
          onChange={event => setPaste(event.target.value)}
          placeholder={p.pastePlaceholder}
          value={paste}
        />
        <div className="flex justify-end">
          <Button disabled={busy || !paste.trim()} onClick={() => void addPasted()} size="sm">
            <Plus className="size-3.5" />
            {p.addKnowledge}
          </Button>
        </div>
      </div>
    </section>
  )
}

function RecentChatsSection({ project }: { project: ChatGroup }) {
  const { t } = useI18n()
  const p = t.sidebar.projects.page
  const navigate = useNavigate()
  const sessions = useStore($sessions)
  const cronSessions = useStore($cronSessions)

  const sessionById = useMemo(() => {
    const map = new Map<string, SessionInfo>()

    for (const session of [...sessions, ...cronSessions]) {
      map.set(session.id, session)
    }

    return map
  }, [sessions, cronSessions])

  return (
    <section>
      <SectionTitle>{p.recentChats}</SectionTitle>
      <div className="mt-3 grid gap-1">
        {project.session_ids.length === 0 ? (
          <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">{p.noChats}</p>
        ) : (
          project.session_ids.map(sessionId => {
            const session = sessionById.get(sessionId)
            const title = session?.title?.trim() || sessionId.slice(0, 8)

            return (
              <button
                className="truncate rounded-md px-3 py-2 text-left text-[0.8125rem] text-(--ui-text-secondary) transition-colors hover:bg-(--ui-row-hover-background) hover:text-foreground"
                key={sessionId}
                onClick={() => navigate(sessionRoute(sessionId))}
                type="button"
              >
                {title}
              </button>
            )
          })
        )}
      </div>
    </section>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{children}</h4>
}
