import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { DisclosureCaret } from '@/components/ui/disclosure-caret'
import { SidebarGroup, SidebarGroupContent } from '@/components/ui/sidebar'
import { Tip } from '@/components/ui/tooltip'
import type { ChatGroup, SessionInfo } from '@/hermes'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import { $projects, deleteProject } from '@/store/projects'
import { $cronSessions, $selectedStoredSessionId, $sessions } from '@/store/session'

import { PROJECTS_ROUTE, projectRoute } from '../../routes'
import { SidebarPanelLabel } from '../../shell/sidebar-label'

import { ProjectSettingsDialog } from './project-dialog'

interface SidebarProjectsSectionProps {
  label: string
  onOpenChat: (sessionId: string) => void
  onToggle: () => void
  open: boolean
}

export function SidebarProjectsSection({ label, onOpenChat, onToggle, open }: SidebarProjectsSectionProps) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const navigate = useNavigate()
  // Clicking a project name opens its full page; navigate from the leaf instead
  // of prop-drilling through the sidebar (mirrors profile-switcher).
  const onOpenProject = (groupId: string) => navigate(projectRoute(groupId))
  const projects = useStore($projects)
  const sessions = useStore($sessions)
  const cronSessions = useStore($cronSessions)
  const [expandedId, setExpandedId] = useState<null | string>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editProject, setEditProject] = useState<ChatGroup | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ChatGroup | null>(null)

  // Resolve member ids to titles off the already-loaded session lists; members
  // not in a loaded page fall back to a short id. (Backend already filters
  // members down to live sessions.)
  const sessionById = useMemo(() => {
    const map = new Map<string, SessionInfo>()

    for (const session of [...sessions, ...cronSessions]) {
      map.set(session.id, session)
    }

    return map
  }, [sessions, cronSessions])

  return (
    <SidebarGroup className="shrink-0 p-0 pb-1">
      <div className="group/section flex shrink-0 items-center justify-between pb-1 pt-1.5">
        <div className="group/section-label flex w-fit items-center gap-1 leading-none">
          <button
            className="flex items-center gap-1 bg-transparent text-left leading-none"
            onClick={() => navigate(PROJECTS_ROUTE)}
            title={label}
            type="button"
          >
            <SidebarPanelLabel>{label}</SidebarPanelLabel>
            <span className="text-[0.6875rem] font-medium text-(--ui-text-quaternary)">{projects.length}</span>
          </button>
          <button
            aria-expanded={open}
            aria-label={label}
            className="bg-transparent leading-none"
            onClick={onToggle}
            type="button"
          >
            <DisclosureCaret
              className="text-(--ui-text-tertiary) opacity-0 transition group-hover/section-label:opacity-100"
              open={open}
            />
          </button>
        </div>
        <Tip label={p.add}>
          <Button
            aria-label={p.add}
            className="text-(--ui-text-tertiary) opacity-0 transition hover:bg-(--ui-control-hover-background) hover:text-foreground group-hover/section:opacity-100"
            onClick={() => {
              triggerHaptic('selection')
              setCreateOpen(true)
            }}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="add" size="0.75rem" />
          </Button>
        </Tip>
      </div>
      {open && (
        <SidebarGroupContent className="flex max-h-72 shrink-0 flex-col gap-px overflow-y-auto overscroll-contain pb-1.75">
          {projects.length === 0 ? (
            <div className="py-1 pl-2 text-[0.6875rem] text-(--ui-text-tertiary)">{p.empty}</div>
          ) : (
            projects.map(project => (
              <ProjectRow
                expanded={expandedId === project.id}
                key={project.id}
                onDelete={() => setDeleteTarget(project)}
                onOpenChat={onOpenChat}
                onOpenProject={onOpenProject}
                onSettings={() => setEditProject(project)}
                onToggle={() => setExpandedId(prev => (prev === project.id ? null : project.id))}
                project={project}
                sessionById={sessionById}
              />
            ))
          )}
        </SidebarGroupContent>
      )}

      <ProjectSettingsDialog onOpenChange={setCreateOpen} open={createOpen} project={null} />
      <ProjectSettingsDialog
        onOpenChange={openValue => {
          if (!openValue) {
            setEditProject(null)
          }
        }}
        open={editProject !== null}
        project={editProject}
      />
      <DeleteProjectDialog onOpenChange={openValue => !openValue && setDeleteTarget(null)} project={deleteTarget} />
    </SidebarGroup>
  )
}

function ProjectRow({
  expanded,
  onDelete,
  onOpenChat,
  onOpenProject,
  onSettings,
  onToggle,
  project,
  sessionById
}: {
  expanded: boolean
  onDelete: () => void
  onOpenChat: (sessionId: string) => void
  onOpenProject: (groupId: string) => void
  onSettings: () => void
  onToggle: () => void
  project: ChatGroup
  sessionById: Map<string, SessionInfo>
}) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const selectedSessionId = useStore($selectedStoredSessionId)
  const count = project.session_ids.length

  return (
    <div>
      <div className="group/project relative grid min-h-[1.625rem] grid-cols-[minmax(0,1fr)_auto] items-center rounded-md hover:bg-(--chrome-action-hover)">
        <button
          className="flex min-w-0 items-center gap-1.5 bg-transparent py-0.5 pl-2 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => onOpenProject(project.id)}
          title={project.name}
          type="button"
        >
          <span className="grid w-3.5 shrink-0 place-items-center">
            <Codicon className="text-(--ui-text-tertiary)" name="folder" size="0.75rem" />
          </span>
          <span className="min-w-0 truncate text-[0.8125rem] text-(--ui-text-secondary) group-hover/project:text-foreground">
            {project.name}
          </span>
        </button>
        <div className="flex items-center gap-0.5 justify-self-end pr-1">
          <span className="text-[0.6875rem] text-(--ui-text-tertiary) tabular-nums group-hover/project:hidden">
            {count}
          </span>
          <div className="hidden items-center gap-0.5 group-hover/project:flex">
            <button
              aria-expanded={expanded}
              aria-label={project.name}
              className="grid size-5 place-items-center rounded-sm text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
              onClick={onToggle}
              type="button"
            >
              <DisclosureCaret open={expanded} />
            </button>
            <Tip label={p.settings}>
              <button
                aria-label={p.settings}
                className="grid size-5 place-items-center rounded-sm text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
                onClick={onSettings}
                type="button"
              >
                <Codicon name="gear" size="0.75rem" />
              </button>
            </Tip>
            <Tip label={p.deleteAction}>
              <button
                aria-label={p.deleteAction}
                className="grid size-5 place-items-center rounded-sm text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-destructive"
                onClick={onDelete}
                type="button"
              >
                <Codicon name="trash" size="0.75rem" />
              </button>
            </Tip>
          </div>
        </div>
      </div>
      {expanded && (
        <div className="mb-1 ml-[1.375rem] flex flex-col gap-px">
          {count === 0 ? (
            <div className="py-1 pl-1 text-[0.6875rem] text-(--ui-text-tertiary)">{p.noChats}</div>
          ) : (
            project.session_ids.map(sessionId => {
              const session = sessionById.get(sessionId)
              const title = session?.title?.trim() || sessionId.slice(0, 8)

              return (
                <button
                  className={cn(
                    'truncate rounded-md px-1.5 py-0.5 text-left text-[0.6875rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                    sessionId === selectedSessionId
                      ? 'bg-(--ui-row-active-background) text-foreground'
                      : 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground'
                  )}
                  key={sessionId}
                  onClick={() => onOpenChat(sessionId)}
                  type="button"
                >
                  {title}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

function DeleteProjectDialog({
  onOpenChange,
  project
}: {
  onOpenChange: (open: boolean) => void
  project: ChatGroup | null
}) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const [submitting, setSubmitting] = useState(false)

  const confirm = async () => {
    if (!project || submitting) {
      return
    }

    setSubmitting(true)

    try {
      await deleteProject(project.id)
      notify({ durationMs: 2_000, kind: 'success', message: p.deleted })
      onOpenChange(false)
    } catch (err) {
      notifyError(err, p.deleteFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={project !== null}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{p.deleteTitle}</DialogTitle>
          <DialogDescription>{project ? p.deleteConfirm(project.name) : ''}</DialogDescription>
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
