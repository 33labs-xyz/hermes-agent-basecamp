import { useStore } from '@nanostores/react'

import { $createSkillOpen, setCreateSkillOpen } from '@/store/create-skill'
import { $gatewayState } from '@/store/session'

import { CreateSkillDialog } from './skills/create-skill-dialog'

// Shared Create Skill overlay: mounted once at the app shell so both the Skills
// page button and the /create-skill slash command can open the same wizard.
// Gated on an open gateway (like ModelPickerOverlay) since creating a skill
// writes through the running hermes backend.
export function CreateSkillOverlay() {
  const gatewayOpen = useStore($gatewayState) === 'open'
  const open = useStore($createSkillOpen)

  if (!gatewayOpen) {
    return null
  }

  return <CreateSkillDialog onOpenChange={setCreateSkillOpen} open={open} />
}
