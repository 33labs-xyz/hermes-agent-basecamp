import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { dragHasSession, readSessionDrag, writeSessionDrag } from '@/app/chat/composer/inline-refs'
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
import { projectMemberTitle } from '@/lib/project-session-title'
import { cn } from '@/lib/utils'
import type { GroupKind } from '@/store/group-kind'
import { notify, notifyError } from '@/store/notifications'
import {
  $projectSessionMeta,
  addOptimisticMembership,
  addSessionToProject,
  deleteProject,
  ensureProjectMemberSessions,
  reorderProjects
} from '@/store/projects'
import { $cronSessions, $selectedStoredSessionId, $sessions } from '@/store/session'

import { projectRoute, PROJECTS_ROUTE } from '../../routes'
import { SidebarPanelLabel } from '../../shell/sidebar-label'

import { ProjectSettingsDialog } from './project-dialog'

export interface SectionStrings {
  add: string
  deleteAction: string
  deleteConfirm: (name: string) => string
  deleteFailed: string
  deleteTitle: string
  deleted: string
  fileFailed: string
  noChats: string
}

export interface SidebarProjectsSectionProps {
  buckets: ChatGroup[]
  kind: GroupKind
  label: string
  onOpenChat: (sessionId: string) => void
  onToggle: () => void
  open: boolean
  strings: SectionStrings
}

export function SidebarProjectsSection({
  buckets,
  kind,
  label,
  onOpenChat,
  onToggle,
  open,
  strings
}: SidebarProjectsSectionProps) {
  const navigate = useNavigate()
  const isProject = kind === 'project'
  // Clicking a project name opens its full page; navigate from the leaf instead
  // of prop-drilling through the sidebar (mirrors profile-switcher).
  const handleOpenProject = (groupId: string) => navigate(projectRoute(groupId))
  const sessions = useStore($sessions)
  const cronSessions = useStore($cronSessions)
  // Distance constraint so a tap-to-open click on a row isn't swallowed by the
  // drag sensor; only a real drag past 4px starts a reorder.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const bucketIds = useMemo(() => buckets.map(b => b.id), [buckets])

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) {
      return
    }

    const from = bucketIds.indexOf(String(active.id))
    const to = bucketIds.indexOf(String(over.id))

    if (from >= 0 && to >= 0) {
      void reorderProjects(arrayMove(bucketIds, from, to))
    }
  }

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

  // Members outside the loaded session lists have no title here; fetch their
  // metadata by id so rows show real titles instead of a bare id prefix.
  const sessionMeta = useStore($projectSessionMeta)
  const knownIds = useMemo(() => new Set(sessionById.keys()), [sessionById])

  useEffect(() => {
    ensureProjectMemberSessions(
      buckets.flatMap(bucket => bucket.session_ids),
      knownIds
    )
  }, [buckets, knownIds])

  return (
    <SidebarGroup className="shrink-0 p-0 pb-1">
      <div className="group/section flex shrink-0 items-center justify-between pb-1 pt-1.5">
        <div className="group/section-label flex w-fit items-center gap-1 leading-none">
          <button
            className="flex items-center gap-1 bg-transparent text-left leading-none"
            onClick={() => (isProject ? navigate(PROJECTS_ROUTE) : onToggle())}
            title={label}
            type="button"
          >
            <SidebarPanelLabel>{label}</SidebarPanelLabel>
            <span className="text-[0.6875rem] font-medium text-(--ui-text-quaternary)">{buckets.length}</span>
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
        <Tip label={strings.add}>
          <Button
            aria-label={strings.add}
            className="text-(--ui-text-tertiary) transition hover:bg-(--ui-control-hover-background) hover:text-foreground"
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
          {buckets.length === 0 ? (
            <button
              className="flex items-center gap-1 py-1 pl-6 pr-2 text-left text-[0.6875rem] text-(--ui-text-tertiary) transition hover:text-foreground"
              onClick={() => setCreateOpen(true)}
              type="button"
            >
              <Codicon name="add" size="0.6875rem" />
              {strings.add}
            </button>
          ) : (
            <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd} sensors={sensors}>
              <SortableContext items={bucketIds} strategy={verticalListSortingStrategy}>
                {buckets.map(bucket => (
                  <ProjectRow
                    expanded={expandedId === bucket.id}
                    key={bucket.id}
                    kind={kind}
                    onDelete={() => setDeleteTarget(bucket)}
                    onOpenChat={onOpenChat}
                    onOpenProject={handleOpenProject}
                    onSettings={() => setEditProject(bucket)}
                    onToggle={() => setExpandedId(prev => (prev === bucket.id ? null : bucket.id))}
                    project={bucket}
                    sessionById={sessionById}
                    sessionMeta={sessionMeta}
                    strings={strings}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </SidebarGroupContent>
      )}

      <ProjectSettingsDialog kind={kind} onOpenChange={setCreateOpen} open={createOpen} project={null} />
      {isProject && (
        <ProjectSettingsDialog
          onOpenChange={openValue => {
            if (!openValue) {
              setEditProject(null)
            }
          }}
          open={editProject !== null}
          project={editProject}
        />
      )}
      <DeleteProjectDialog
        onOpenChange={openValue => !openValue && setDeleteTarget(null)}
        project={deleteTarget}
        strings={strings}
      />
    </SidebarGroup>
  )
}

function ProjectRow({
  expanded,
  kind,
  onDelete,
  onOpenChat,
  onOpenProject,
  onSettings,
  onToggle,
  project,
  sessionById,
  sessionMeta,
  strings
}: {
  expanded: boolean
  kind: GroupKind
  onDelete: () => void
  onOpenChat: (sessionId: string) => void
  onOpenProject: (groupId: string) => void
  onSettings: () => void
  onToggle: () => void
  project: ChatGroup
  sessionById: Map<string, SessionInfo>
  sessionMeta: Record<string, null | SessionInfo>
  strings: SectionStrings
}) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const isProject = kind === 'project'
  const selectedSessionId = useStore($selectedStoredSessionId)
  const count = project.session_ids.length
  // Whole row is the drag handle (distance-constrained sensor keeps clicks working).
  // Vertical list: translate Y only so a dragged row never drifts sideways.
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({ id: project.id })
  // Native HTML5 drop target highlight, separate from dnd-kit's pointer-based
  // reorder drag above. A session dropped from the flat recents list or
  // another bucket files it here (see onDrop below).
  const [dropActive, setDropActive] = useState(false)

  const sortableStyle = {
    transform: transform ? `translate3d(0px, ${transform.y}px, 0)` : undefined,
    transition: isDragging ? undefined : transition,
    willChange: isDragging ? 'transform' : undefined,
    zIndex: isDragging ? 1 : undefined
  }

  return (
    <div ref={setNodeRef} style={sortableStyle}>
      <div
        className={cn(
          'group/project relative grid min-h-[1.625rem] grid-cols-[minmax(0,1fr)_auto] items-center rounded-md hover:bg-(--chrome-action-hover)',
          isDragging && 'bg-(--chrome-action-hover) opacity-80',
          dropActive && 'ring-1 ring-inset ring-(--ui-accent)'
        )}
        {...attributes}
        {...listeners}
        onDragOver={event => {
          if (!dragHasSession(event.dataTransfer)) {
            return
          }
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDropActive(true)
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={event => {
          setDropActive(false)
          const payload = readSessionDrag(event.dataTransfer)
          if (!payload) {
            return
          }
          event.preventDefault()
          if (project.session_ids.includes(payload.id)) {
            return
          }
          addOptimisticMembership(project.id, payload.id)
          addSessionToProject(project.id, payload.id).catch(err => notifyError(err, strings.fileFailed))
        }}
      >
        <button
          className="flex min-w-0 items-center gap-1.5 bg-transparent py-0.5 pl-2 pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => (isProject ? onOpenProject(project.id) : onToggle())}
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
            {isProject && (
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
            )}
            <Tip label={strings.deleteAction}>
              <button
                aria-label={strings.deleteAction}
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
            <div className="py-1 pl-1 text-[0.6875rem] text-(--ui-text-tertiary)">{strings.noChats}</div>
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
                  className={cn(
                    'truncate rounded-md px-1.5 py-0.5 text-left text-[0.6875rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                    sessionId === selectedSessionId
                      ? 'bg-(--ui-row-active-background) text-foreground'
                      : 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground'
                  )}
                  draggable
                  key={sessionId}
                  onClick={() => onOpenChat(sessionId)}
                  onDragStart={event =>
                    writeSessionDrag(event.dataTransfer, {
                      id: sessionId,
                      profile: 'default',
                      title
                    })
                  }
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
  project,
  strings
}: {
  onOpenChange: (open: boolean) => void
  project: ChatGroup | null
  strings: SectionStrings
}) {
  const { t } = useI18n()
  const [submitting, setSubmitting] = useState(false)

  const confirm = async () => {
    if (!project || submitting) {
      return
    }

    setSubmitting(true)

    try {
      await deleteProject(project.id)
      notify({ durationMs: 2_000, kind: 'success', message: strings.deleted })
      onOpenChange(false)
    } catch (err) {
      notifyError(err, strings.deleteFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={project !== null}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{strings.deleteTitle}</DialogTitle>
          <DialogDescription>{project ? strings.deleteConfirm(project.name) : ''}</DialogDescription>
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
