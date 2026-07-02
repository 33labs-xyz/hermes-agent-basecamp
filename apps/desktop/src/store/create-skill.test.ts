import { afterEach, describe, expect, it } from 'vitest'

import { $createSkillOpen, $skillsRefreshSignal, bumpSkillsRefresh, setCreateSkillOpen } from './create-skill'

afterEach(() => {
  $createSkillOpen.set(false)
  $skillsRefreshSignal.set(0)
})

describe('create-skill store', () => {
  it('defaults the dialog closed', () => {
    expect($createSkillOpen.get()).toBe(false)
  })

  it('setCreateSkillOpen toggles the atom', () => {
    setCreateSkillOpen(true)
    expect($createSkillOpen.get()).toBe(true)
    setCreateSkillOpen(false)
    expect($createSkillOpen.get()).toBe(false)
  })

  it('bumpSkillsRefresh increments monotonically', () => {
    expect($skillsRefreshSignal.get()).toBe(0)
    bumpSkillsRefresh()
    bumpSkillsRefresh()
    expect($skillsRefreshSignal.get()).toBe(2)
  })
})
