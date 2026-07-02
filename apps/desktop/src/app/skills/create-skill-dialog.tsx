import { useEffect, useState } from 'react'

import { ActionStatus } from '@/components/ui/action-status'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createSkill } from '@/hermes'
import { useI18n } from '@/i18n'
import { AlertTriangle } from '@/lib/icons'
import { bumpSkillsRefresh } from '@/store/create-skill'
import { notify } from '@/store/notifications'

import { buildSkillMarkdown, friendlyCreateSkillError, isValidSkillSlug, slugifySkillName } from './create-skill-utils'

interface CreateSkillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const NAME_INPUT_MAX = 80
const DESCRIPTION_MAX = 1024
const INSTRUCTIONS_MAX = 100_000
const DONE_CLOSE_DELAY_MS = 600

// Single-panel Create Skill wizard: fields on the left, a live SKILL.md preview
// underneath. Owns the saving -> done -> close beat and inline error, mirroring
// ConfirmDialog. Cmd/Ctrl+Enter submits (plain Enter stays free for the textarea).
export function CreateSkillDialog({ open, onOpenChange }: CreateSkillDialogProps) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [status, setStatus] = useState<'done' | 'idle' | 'saving'>('idle')
  const [error, setError] = useState<null | string>(null)

  const slug = slugifySkillName(name)
  const slugValid = isValidSkillSlug(slug)
  const preview = buildSkillMarkdown({ description, instructions, slug: slugValid ? slug : 'your-skill' })
  const busy = status === 'saving' || status === 'done'
  const canSubmit = slugValid && description.trim().length > 0 && instructions.trim().length > 0 && !busy

  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setInstructions('')
      setStatus('idle')
      setError(null)
    }
  }, [open])

  async function run() {
    if (!canSubmit) {
      return
    }

    setStatus('saving')
    setError(null)

    try {
      await createSkill(slug, buildSkillMarkdown({ description, instructions, slug }))
      bumpSkillsRefresh()
      notify({ kind: 'success', message: t.skills.createSuccess(slug) })
      setStatus('done')
      window.setTimeout(() => onOpenChange(false), DONE_CLOSE_DELAY_MS)
    } catch (err) {
      setStatus('idle')
      setError(friendlyCreateSkillError(err, t.skills.createFailed))
    }
  }

  return (
    <Dialog onOpenChange={value => !value && !busy && onOpenChange(false)} open={open}>
      <DialogContent
        className="max-w-lg"
        onKeyDown={event => {
          // Cmd/Ctrl+Enter submits from anywhere; plain Enter stays free so the
          // instructions textarea can take newlines.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSubmit) {
            event.preventDefault()
            void run()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t.skills.createTitle}</DialogTitle>
          <DialogDescription>{t.skills.createDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="create-skill-name">
              {t.skills.createNameLabel}
            </label>
            <Input
              id="create-skill-name"
              maxLength={NAME_INPUT_MAX}
              onChange={event => setName(event.target.value)}
              placeholder={t.skills.createNamePlaceholder}
              value={name}
            />
            {name.trim().length > 0 &&
              (slugValid ? (
                <p className="text-xs text-muted-foreground">
                  {t.skills.createSlugPrefix} <code className="rounded bg-muted px-1 py-0.5 font-mono">{slug}</code>
                </p>
              ) : (
                <p className="text-xs text-destructive">{t.skills.createSlugInvalid}</p>
              ))}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="create-skill-description">
              {t.skills.createDescriptionLabel}
            </label>
            <Input
              id="create-skill-description"
              maxLength={DESCRIPTION_MAX}
              onChange={event => setDescription(event.target.value)}
              placeholder={t.skills.createDescriptionPlaceholder}
              value={description}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="create-skill-instructions">
              {t.skills.createInstructionsLabel}
            </label>
            <Textarea
              className="min-h-28"
              id="create-skill-instructions"
              maxLength={INSTRUCTIONS_MAX}
              onChange={event => setInstructions(event.target.value)}
              placeholder={t.skills.createInstructionsPlaceholder}
              value={instructions}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t.skills.createPreviewLabel}</p>
            <pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
              {preview}
            </pre>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <DialogFooter>
          <Button disabled={busy} onClick={() => onOpenChange(false)} type="button" variant="ghost">
            {t.common.cancel}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void run()} type="button">
            <ActionStatus busy={t.skills.createSubmitting} done={t.skills.createDone} idle={t.skills.createSubmit} state={status} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
