import { atom } from 'nanostores'

// Whether the Create Skill wizard overlay is open. Set from the Skills-page
// button and from the /create-skill slash command; the overlay reads it.
export const $createSkillOpen = atom(false)

export function setCreateSkillOpen(open: boolean): void {
  $createSkillOpen.set(open)
}

// Monotonic counter the Skills page subscribes to so it refetches after a skill
// is created from the shared overlay (which is not a child of the Skills page).
export const $skillsRefreshSignal = atom(0)

export function bumpSkillsRefresh(): void {
  $skillsRefreshSignal.set($skillsRefreshSignal.get() + 1)
}
