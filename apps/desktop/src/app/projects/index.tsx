import { useStore } from '@nanostores/react'
import type * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  addKnowledgeFile,
  type ChatGroup,
  type ChatKnowledgeFile,
  createCronJob,
  type CronJob,
  deleteCronJob,
  deleteKnowledgeFile,
  getCronJobsForGroup,
  listKnowledgeFiles,
  pauseCronJob,
  resumeCronJob,
  type SessionInfo
} from '@/hermes'
import { useI18n } from '@/i18n'
import { ArrowUp, ChevronDown, ChevronLeft, Clock, FileText, FolderOpen, MoreHorizontal, Pencil, Plus, Trash2 } from '@/lib/icons'
import { formatModelStatusLabel } from '@/lib/model-status-label'
import { projectMemberTitle } from '@/lib/project-session-title'
import { cn } from '@/lib/utils'
import { stashSessionDraft } from '@/store/composer'
import { notify, notifyError } from '@/store/notifications'
import {
  $projects,
  $projectsLoading,
  $projectSessionMeta,
  deleteProject,
  ensureProjectMemberSessions,
  setPendingProjectForNewChat,
  updateProject
} from '@/store/projects'
import {
  $cronSessions,
  $currentFastMode,
  $currentModel,
  $currentReasoningEffort,
  $sessions,
  setModelPickerOpen
} from '@/store/session'

import { ProjectSettingsDialog } from '../chat/sidebar/project-dialog'
import { PageSearchShell } from '../page-search-shell'
import { NEW_CHAT_ROUTE, PROJECTS_ROUTE, projectRoute, sessionRoute } from '../routes'
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

// Mirror the backend per-file content cap (_FILE_CONTENT_MAX). Validate here so
// an oversized paste/upload fails fast with a friendly message instead of a 4xx.
const KNOWLEDGE_CONTENT_MAX = 200_000
// Fallback name for pasted text when the user leaves the name field blank.
const PASTED_KNOWLEDGE_NAME = 'note.md'
// Mirror the backend KNOWLEDGE_CONTEXT_MAX inject budget. The capacity meter
// shows how much of this budget the project's knowledge files consume; content
// past it is truncated server-side at agent build.
const KNOWLEDGE_BUDGET = 32_000
// Cron job names surface in the global Scheduled dashboard, so derive a short one
// from the prompt rather than dumping the whole instruction into the name slot.
const SCHEDULED_NAME_MAX = 60

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

  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  // Still resolving the project list on a cold open — wait before deciding the
  // id is bad, so a deep link doesn't flash "not found" before projects load.
  const stillLoading = loading && projects.length === 0
  const isLanding = groupId === ''

  const header = isLanding ? (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <FolderOpen className="size-4 shrink-0 text-(--ui-text-tertiary)" />
      <h2 className="min-w-0 truncate text-[0.9375rem] font-semibold tracking-tight">{t.sidebar.projects.label}</h2>
      <Button className="ml-auto" onClick={() => setCreateOpen(true)} size="sm" variant="textStrong">
        <Plus className="size-3.5" />
        {t.sidebar.projects.add}
      </Button>
    </div>
  ) : (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Button aria-label={p.back} onClick={() => navigate(NEW_CHAT_ROUTE)} size="icon-xs" variant="ghost">
        <ChevronLeft className="size-4" />
      </Button>
      <FolderOpen className="size-4 shrink-0 text-(--ui-text-tertiary)" />
      <h2 className="min-w-0 truncate text-[0.9375rem] font-semibold tracking-tight">
        {project ? project.name : p.notFound}
      </h2>
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
      {isLanding ? (
        <ProjectsLanding loading={stillLoading} onCreate={() => setCreateOpen(true)} projects={projects} />
      ) : project ? (
        <ProjectWorkspace key={project.id} onEdit={() => setEditOpen(true)} project={project} />
      ) : stillLoading ? (
        <PageLoader label={p.openProject} />
      ) : (
        <div className="grid h-full place-items-center px-6 text-center text-sm text-(--ui-text-tertiary)">
          {p.notFound}
        </div>
      )}

      <ProjectSettingsDialog onOpenChange={setCreateOpen} open={createOpen} project={null} />
      {project && (
        <ProjectSettingsDialog onOpenChange={setEditOpen} open={editOpen} project={project} />
      )}
    </PageSearchShell>
  )
}

// Arm the one-shot project assignment, then open a blank chat. The next backend
// session created for a send consumes the arm and lands in this project.
function startNewChat(projectId: string, navigate: (to: string) => void) {
  setPendingProjectForNewChat(projectId)
  navigate(NEW_CHAT_ROUTE)
}

function ProjectsLanding({
  loading,
  onCreate,
  projects
}: {
  loading: boolean
  onCreate: () => void
  projects: ChatGroup[]
}) {
  const { t } = useI18n()
  const p = t.sidebar.projects.page
  const navigate = useNavigate()

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-5 py-6">
        <p className="text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {p.subtitle}
        </p>

        {loading ? (
          <div className="mt-6 text-sm text-(--ui-text-tertiary)">…</div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <button
              className="flex min-h-[7.5rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-(--ui-divider) p-4 text-(--ui-text-tertiary) transition-colors hover:border-(--ui-stroke-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
              onClick={onCreate}
              type="button"
            >
              <Plus className="size-5" />
              <span className="text-[0.8125rem] font-medium">{t.sidebar.projects.add}</span>
            </button>

            {projects.map(project => (
              <button
                className="group flex min-h-[7.5rem] flex-col gap-1.5 rounded-xl border border-(--ui-divider) p-4 text-left transition-colors hover:border-(--ui-stroke-tertiary) hover:bg-(--ui-control-hover-background)"
                key={project.id}
                onClick={() => navigate(projectRoute(project.id))}
                title={project.name}
                type="button"
              >
                <FolderOpen className="size-5 shrink-0 text-(--ui-text-tertiary)" />
                <span className="truncate text-[0.875rem] font-semibold tracking-tight">{project.name}</span>
                {project.description.trim() && (
                  <span className="line-clamp-2 text-[0.75rem] leading-snug text-(--ui-text-tertiary)">
                    {project.description}
                  </span>
                )}
                <span className="mt-auto text-[0.6875rem] text-(--ui-text-quaternary) tabular-nums">
                  {p.chatCount(project.session_ids.length)}
                </span>
              </button>
            ))}
          </div>
        )}

        {!loading && projects.length === 0 && (
          <p className="mt-4 text-sm text-(--ui-text-tertiary)">{t.sidebar.projects.empty}</p>
        )}
      </div>
    </div>
  )
}

function ProjectWorkspace({ onEdit, project }: { onEdit: () => void; project: ChatGroup }) {
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <div className="flex min-h-0 flex-1">
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 px-5 py-6">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
              {project.description.trim() && (
                <p className="mt-1 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
                  {project.description}
                </p>
              )}
            </div>
            <ProjectActionsMenu onDelete={() => setDeleteOpen(true)} onEdit={onEdit} />
          </div>
          <ProjectComposer project={project} />
          <ChatsSection project={project} />
        </div>
      </main>
      <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-(--ui-divider) lg:block">
        <div className="space-y-4 px-4 py-5">
          <InstructionsCard onEdit={onEdit} project={project} />
          <ScheduledCard project={project} />
          <ContextCard project={project} />
        </div>
      </aside>
      <DeleteProjectDialog onOpenChange={setDeleteOpen} open={deleteOpen} project={project} />
    </div>
  )
}

// Launchpad composer: type a prompt, hit send, and the real chat (with full
// attachments/voice composer) opens inside this project via the pending-assign
// arm + a stashed new-session draft. No fake buttons here — the affordances that
// can't act on this page (attach, voice) live in the chat we hand off to.
function ProjectComposer({ project }: { project: ChatGroup }) {
  const { t } = useI18n()
  const p = t.sidebar.projects.page
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const currentModel = useStore($currentModel)
  const fastMode = useStore($currentFastMode)
  const reasoningEffort = useStore($currentReasoningEffort)

  function submit() {
    const draft = text.trim()
    setPendingProjectForNewChat(project.id)

    if (draft) {
      stashSessionDraft(null, draft, [])
    }

    navigate(NEW_CHAT_ROUTE)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="rounded-2xl border border-(--ui-divider) bg-(--ui-control-background) px-3 py-2.5 shadow-sm focus-within:border-(--ui-stroke-tertiary)">
      <Textarea
        className="min-h-[3rem] resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        onChange={event => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={p.composerPlaceholder}
        value={text}
      />
      <div className="mt-1 flex items-center gap-2">
        <button
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground"
          onClick={() => setModelPickerOpen(true)}
          type="button"
        >
          <span className="truncate">
            {currentModel.trim()
              ? formatModelStatusLabel(currentModel, { fastMode, reasoningEffort })
              : t.shell.statusbar.modelNone}
          </span>
          <ChevronDown className="size-2.5 shrink-0 opacity-50" />
        </button>
        <Button
          aria-label={p.composerSend}
          className="ml-auto size-7 rounded-full"
          onClick={submit}
          size="icon"
          title={p.composerSend}
          variant="textStrong"
        >
          <ArrowUp className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

function ProjectActionsMenu({ onDelete, onEdit }: { onDelete: () => void; onEdit: () => void }) {
  const { t } = useI18n()
  const p = t.sidebar.projects.page

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={p.projectActions} className="shrink-0" size="icon-sm" variant="ghost">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil className="size-3.5" />
          {p.edit}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} variant="destructive">
          <Trash2 className="size-3.5" />
          {t.sidebar.projects.deleteAction}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Right-column card shell: header (icon + title, optional trailing controls) and
// a collapsible body. DRY base for every aside card so they read identically.
function ProjectCard({
  children,
  collapsed,
  controls,
  icon,
  onToggle,
  title
}: {
  children: React.ReactNode
  collapsed?: boolean
  controls?: React.ReactNode
  icon: React.ReactNode
  onToggle?: () => void
  title: string
}) {
  return (
    <section className="rounded-xl border border-(--ui-divider) p-3.5">
      <div className="flex items-center gap-2">
        <span className="grid size-4 shrink-0 place-items-center text-(--ui-text-tertiary)">{icon}</span>
        <h4 className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold tracking-tight">{title}</h4>
        {controls}
        {onToggle && (
          <button
            aria-expanded={!collapsed}
            className="grid size-6 shrink-0 place-items-center rounded-sm text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
            onClick={onToggle}
            type="button"
          >
            <ChevronDown className={cn('size-3.5 transition-transform', collapsed && '-rotate-90')} />
          </button>
        )}
      </div>
      {!collapsed && <div className="mt-3">{children}</div>}
    </section>
  )
}

function InstructionsCard({ onEdit, project }: { onEdit: () => void; project: ChatGroup }) {
  const { t } = useI18n()
  const p = t.sidebar.projects.page
  const [collapsed, setCollapsed] = useState(false)
  const text = project.instructions.trim()

  return (
    <ProjectCard
      collapsed={collapsed}
      controls={
        <button
          aria-label={p.edit}
          className="grid size-6 shrink-0 place-items-center rounded-sm text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
          onClick={onEdit}
          title={p.edit}
          type="button"
        >
          <Pencil className="size-3.5" />
        </button>
      }
      icon={<FileText className="size-3.5" />}
      onToggle={() => setCollapsed(prev => !prev)}
      title={p.instructionsTitle}
    >
      {text ? (
        <p className="whitespace-pre-wrap text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-secondary)">
          {text}
        </p>
      ) : (
        <p className="text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
          {p.instructionsHint}
        </p>
      )}
    </ProjectCard>
  )
}

// Project-scoped scheduling: lists the cron jobs tagged with this project's
// group_id and lets you add one without leaving the workspace. Backed by the
// real cron subsystem (multi-profile aggregation happens server-side), so a row
// here is a live recurring task, not a placeholder.
function ScheduledCard({ project }: { project: ChatGroup }) {
  const { t } = useI18n()
  const p = t.sidebar.projects.page
  const [jobs, setJobs] = useState<CronJob[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [schedule, setSchedule] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    getCronJobsForGroup(project.id)
      .then(loaded => {
        if (!cancelled) {
          setJobs(loaded)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setJobs([])
          notifyError(err, p.scheduledLoadFailed)
        }
      })

    return () => {
      cancelled = true
    }
  }, [project.id, p.scheduledLoadFailed])

  async function create() {
    const trimmedPrompt = prompt.trim()
    const trimmedSchedule = schedule.trim()

    if (!trimmedPrompt || !trimmedSchedule) {
      return
    }

    setBusy(true)

    try {
      const created = await createCronJob({
        group_id: project.id,
        name: trimmedPrompt.slice(0, SCHEDULED_NAME_MAX),
        prompt: trimmedPrompt,
        schedule: trimmedSchedule
      })
      setJobs(current => [...(current ?? []), created])
      setPrompt('')
      setSchedule('')
      setAdding(false)
      notify({ durationMs: 2_000, kind: 'success', message: p.scheduledCreated })
    } catch (err) {
      notifyError(err, p.scheduledCreateFailed)
    } finally {
      setBusy(false)
    }
  }

  async function toggle(job: CronJob) {
    try {
      const updated = job.enabled ? await pauseCronJob(job.id) : await resumeCronJob(job.id)
      setJobs(current => (current ?? []).map(row => (row.id === updated.id ? updated : row)))
    } catch (err) {
      notifyError(err, p.scheduledToggleFailed)
    }
  }

  async function remove(jobId: string) {
    try {
      await deleteCronJob(jobId)
      setJobs(current => (current ?? []).filter(row => row.id !== jobId))
      notify({ durationMs: 2_000, kind: 'success', message: p.scheduledDeleted })
    } catch (err) {
      notifyError(err, p.scheduledDeleteFailed)
    }
  }

  return (
    <ProjectCard
      controls={
        !adding && (
          <button
            aria-label={p.scheduledAdd}
            className="grid size-6 shrink-0 place-items-center rounded-sm text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
            onClick={() => setAdding(true)}
            title={p.scheduledAdd}
            type="button"
          >
            <Plus className="size-3.5" />
          </button>
        )
      }
      icon={<Clock className="size-3.5" />}
      title={p.scheduledTitle}
    >
      <div className="grid gap-1">
        {jobs === null ? (
          <p className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">…</p>
        ) : jobs.length === 0 ? (
          <p className="text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
            {p.scheduledEmpty}
          </p>
        ) : (
          jobs.map(job => (
            <div
              className="flex items-center gap-2 rounded-md border border-(--ui-divider) px-3 py-2"
              key={job.id}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8125rem]">{job.name?.trim() || job.prompt?.trim() || job.id}</p>
                <p className="truncate text-[0.66rem] text-(--ui-text-tertiary)">
                  {job.schedule_display?.trim() || p.scheduledNoCadence}
                  {!job.enabled && ` · ${p.scheduledPaused}`}
                </p>
              </div>
              <button
                aria-label={job.enabled ? p.scheduledPause : p.scheduledResume}
                className="shrink-0 rounded-sm px-1.5 py-1 text-[0.66rem] text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
                onClick={() => void toggle(job)}
                title={job.enabled ? p.scheduledPause : p.scheduledResume}
                type="button"
              >
                {job.enabled ? p.scheduledPause : p.scheduledResume}
              </button>
              <Button
                aria-label={p.scheduledDelete}
                className="size-7 shrink-0"
                onClick={() => void remove(job.id)}
                size="icon"
                title={p.scheduledDelete}
                variant="ghost"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>

      {adding && (
        <div className="mt-3 space-y-2 rounded-lg border border-(--ui-divider) p-3">
          <Textarea
            aria-label={p.scheduledPromptLabel}
            onChange={event => setPrompt(event.target.value)}
            placeholder={p.scheduledPromptPlaceholder}
            value={prompt}
          />
          <Input
            aria-label={p.scheduledCadenceLabel}
            onChange={event => setSchedule(event.target.value)}
            placeholder={p.scheduledCadencePlaceholder}
            value={schedule}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                setAdding(false)
                setPrompt('')
                setSchedule('')
              }}
              size="sm"
              variant="ghost"
            >
              {p.scheduledCancel}
            </Button>
            <Button disabled={busy || !prompt.trim() || !schedule.trim()} onClick={() => void create()} size="sm">
              <Plus className="size-3.5" />
              {p.scheduledCreate}
            </Button>
          </div>
        </div>
      )}
    </ProjectCard>
  )
}

function ContextCard({ project }: { project: ChatGroup }) {
  const { t } = useI18n()
  const p = t.sidebar.projects.page

  // Memory lands in a follow-up push once its backend store exists; shipping an
  // honest-empty placeholder now would imply a capture flow that isn't wired yet.
  return (
    <ProjectCard icon={<FolderOpen className="size-3.5" />} title={p.contextTitle}>
      <KnowledgeSection project={project} />
    </ProjectCard>
  )
}

function DeleteProjectDialog({
  onOpenChange,
  open,
  project
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
  project: ChatGroup
}) {
  const { t } = useI18n()
  const pr = t.sidebar.projects
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)

  async function confirm() {
    if (submitting) {
      return
    }

    setSubmitting(true)

    try {
      await deleteProject(project.id)
      notify({ durationMs: 2_000, kind: 'success', message: pr.deleted })
      onOpenChange(false)
      navigate(PROJECTS_ROUTE)
    } catch (err) {
      notifyError(err, pr.deleteFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{pr.deleteTitle}</DialogTitle>
          <DialogDescription>{pr.deleteConfirm(project.name)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={submitting} onClick={() => onOpenChange(false)} type="button" variant="ghost">
            {t.common.cancel}
          </Button>
          <Button disabled={submitting} onClick={() => void confirm()} type="button" variant="destructive">
            {t.common.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

  // Sum of stored characters across the project's knowledge files, capped at the
  // inject budget for the meter fill (content past it is truncated server-side).
  const used = (files ?? []).reduce((total, file) => total + file.size, 0)
  const pct = Math.min(100, Math.round((used / KNOWLEDGE_BUDGET) * 100))
  const full = used >= KNOWLEDGE_BUDGET

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

      <div className="mt-3">
        <div className="flex items-center justify-between text-[0.66rem] text-(--ui-text-tertiary)">
          <span>{p.capacityTitle}</span>
          <span className="tabular-nums">{p.capacityUsage(used, KNOWLEDGE_BUDGET)}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-(--ui-divider)">
          <div
            className={full ? 'h-full rounded-full bg-destructive' : 'h-full rounded-full bg-(--ui-text-tertiary)'}
            style={{ width: `${pct}%` }}
          />
        </div>
        {full && <p className="mt-1 text-[0.66rem] text-destructive">{p.capacityFull}</p>}
      </div>

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

function ChatsSection({ project }: { project: ChatGroup }) {
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

  // Members outside the loaded session lists have no title here; fetch their
  // metadata by id so rows show real titles instead of a bare id prefix.
  const sessionMeta = useStore($projectSessionMeta)
  const knownIds = useMemo(() => new Set(sessionById.keys()), [sessionById])

  useEffect(() => {
    ensureProjectMemberSessions(project.session_ids, knownIds)
  }, [project.session_ids, knownIds])

  return (
    <section>
      <SectionTitle>{p.recentChats}</SectionTitle>
      <div className="mt-3 grid gap-1">
        <button
          className="flex items-center gap-2 rounded-lg border border-dashed border-(--ui-divider) px-3 py-2.5 text-left text-[0.8125rem] text-(--ui-text-secondary) transition-colors hover:border-(--ui-stroke-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
          onClick={() => startNewChat(project.id, navigate)}
          type="button"
        >
          <Plus className="size-3.5 shrink-0 text-(--ui-text-tertiary)" />
          {p.newChat}
        </button>

        {project.session_ids.length === 0 ? (
          <p className="px-1 py-1 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
            {p.noChats}
          </p>
        ) : (
          project.session_ids.map(sessionId => {
            const session = sessionById.get(sessionId)
            const title = projectMemberTitle(
              session,
              sessionMeta[sessionId],
              t.sidebar.row.untitledPlaceholder
            )

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
