import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { ChatGroup } from '@/hermes'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { notify, notifyError } from '@/store/notifications'
import {
  addSessionToProject,
  createProject,
  removeSessionFromProject,
  updateProject
} from '@/store/projects'

// Backend caps (mirror hermes_cli/chat_groups/routes.py). Enforced here too so
// the dialog gives instant feedback instead of a round-trip rejection.
const NAME_MAX = 100
const DESCRIPTION_MAX = 500
const INSTRUCTIONS_MAX = 16000

interface ProjectSettingsDialogProps {
  onOpenChange: (open: boolean) => void
  open: boolean
  // Editing an existing project, or null when creating a new one.
  project: ChatGroup | null
}

// Create-or-edit dialog. `project === null` → create; otherwise edit that
// project. Name is required; description and instructions are optional.
export function ProjectSettingsDialog({ onOpenChange, open, project }: ProjectSettingsDialogProps) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const editing = project !== null
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName(project?.name ?? '')
      setDescription(project?.description ?? '')
      setInstructions(project?.instructions ?? '')
      window.setTimeout(() => nameRef.current?.focus(), 0)
    }
  }, [open, project])

  const trimmedName = name.trim()
  const canSubmit = trimmedName.length > 0 && trimmedName.length <= NAME_MAX && !submitting

  const submit = async () => {
    if (!canSubmit) {
      return
    }

    setSubmitting(true)

    const payload = {
      name: trimmedName,
      description: description.trim().slice(0, DESCRIPTION_MAX),
      instructions: instructions.trim().slice(0, INSTRUCTIONS_MAX)
    }

    try {
      if (editing && project) {
        await updateProject(project.id, payload)
        notify({ durationMs: 2_000, kind: 'success', message: p.saved })
      } else {
        await createProject(payload)
        notify({ durationMs: 2_000, kind: 'success', message: p.created })
      }

      onOpenChange(false)
    } catch (err) {
      notifyError(err, editing ? p.saveFailed : p.createFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? p.editTitle : p.createTitle}</DialogTitle>
        </DialogHeader>
        <label className="flex flex-col gap-1">
          <span className="text-[0.75rem] font-medium text-(--ui-text-secondary)">{p.nameLabel}</span>
          <Input
            disabled={submitting}
            maxLength={NAME_MAX}
            onChange={event => setName(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder={p.namePlaceholder}
            ref={nameRef}
            value={name}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[0.75rem] font-medium text-(--ui-text-secondary)">{p.descriptionLabel}</span>
          <Textarea
            className="min-h-12"
            disabled={submitting}
            maxLength={DESCRIPTION_MAX}
            onChange={event => setDescription(event.target.value)}
            placeholder={p.descriptionPlaceholder}
            value={description}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[0.75rem] font-medium text-(--ui-text-secondary)">{p.instructionsLabel}</span>
          <Textarea
            className="min-h-24"
            disabled={submitting}
            maxLength={INSTRUCTIONS_MAX}
            onChange={event => setInstructions(event.target.value)}
            placeholder={p.instructionsPlaceholder}
            value={instructions}
          />
          <span className="text-[0.6875rem] text-(--ui-text-tertiary)">{p.instructionsHint}</span>
        </label>
        <DialogFooter>
          <Button disabled={submitting} onClick={() => onOpenChange(false)} type="button" variant="ghost">
            {t.common.cancel}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()} type="button">
            {editing ? t.common.save : p.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface AssignProjectDialogProps {
  onOpenChange: (open: boolean) => void
  open: boolean
  projects: ChatGroup[]
  sessionId: string
}

// Pick which project a chat belongs to (or none). A session belongs to at most
// one project, so this is a single-select that assigns/unassigns on save.
export function AssignProjectDialog({ onOpenChange, open, projects, sessionId }: AssignProjectDialogProps) {
  const { t } = useI18n()
  const p = t.sidebar.projects
  const currentProjectId = projects.find(group => group.session_ids.includes(sessionId))?.id ?? null
  const [selected, setSelected] = useState<null | string>(currentProjectId)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setSelected(currentProjectId)
    }
  }, [open, currentProjectId])

  const submit = async () => {
    if (submitting || selected === currentProjectId) {
      onOpenChange(false)

      return
    }

    setSubmitting(true)

    try {
      if (selected) {
        // Assigning to a new project moves it (backend membership is unique per
        // session), so a single assign is enough.
        await addSessionToProject(selected, sessionId)
        notify({ durationMs: 2_000, kind: 'success', message: p.assigned })
      } else if (currentProjectId) {
        await removeSessionFromProject(currentProjectId, sessionId)
        notify({ durationMs: 2_000, kind: 'success', message: p.removed })
      }

      onOpenChange(false)
    } catch (err) {
      notifyError(err, selected ? p.assignFailed : p.removeFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{p.assignTitle}</DialogTitle>
          <DialogDescription>{p.assignDesc}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-72 flex-col gap-px overflow-y-auto">
          <ProjectChoiceRow
            label={p.none}
            onSelect={() => setSelected(null)}
            selected={selected === null}
          />
          {projects.map(group => (
            <ProjectChoiceRow
              key={group.id}
              label={group.name}
              onSelect={() => setSelected(group.id)}
              selected={selected === group.id}
            />
          ))}
        </div>
        <DialogFooter>
          <Button disabled={submitting} onClick={() => onOpenChange(false)} type="button" variant="ghost">
            {t.common.cancel}
          </Button>
          <Button disabled={submitting} onClick={() => void submit()} type="button">
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProjectChoiceRow({
  label,
  onSelect,
  selected
}: {
  label: string
  onSelect: () => void
  selected: boolean
}) {
  return (
    <button
      className={
        selected
          ? 'flex items-center justify-between rounded-md bg-(--ui-row-active-background) px-2.5 py-1.5 text-left text-[0.8125rem] text-foreground'
          : 'flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[0.8125rem] text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground'
      }
      onClick={() => {
        triggerHaptic('selection')
        onSelect()
      }}
      type="button"
    >
      <span className="min-w-0 truncate">{label}</span>
      {selected && <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />}
    </button>
  )
}
