import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $skillsRefreshSignal } from '@/store/create-skill'

const createSkillMock = vi.fn()
vi.mock('@/hermes', () => ({
  createSkill: (name: string, content: string, category?: string) => createSkillMock(name, content, category)
}))
vi.mock('@/store/notifications', () => ({ notify: vi.fn(), notifyError: vi.fn() }))

import { CreateSkillDialog } from './create-skill-dialog'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  $skillsRefreshSignal.set(0)
})

function fill(name: string, description: string, instructions: string) {
  fireEvent.change(screen.getByLabelText("What's it called?"), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('One line: what it does and when to use it'), {
    target: { value: description }
  })
  fireEvent.change(screen.getByLabelText('What should the skill tell the assistant to do?'), {
    target: { value: instructions }
  })
}

describe('CreateSkillDialog', () => {
  it('shows the derived slug and a live SKILL.md preview', () => {
    render(<CreateSkillDialog onOpenChange={() => {}} open />)
    fill('Weekly Report', 'Does X.', 'Step one.')

    expect(screen.getByText('weekly-report')).toBeTruthy()
    const preview = screen.getByText(/name: weekly-report/)
    expect(preview.textContent).toContain('description: Does X.')
    expect(preview.textContent).toContain('Step one.')
  })

  it('disables Create until slug, description, and instructions are valid', () => {
    render(<CreateSkillDialog onOpenChange={() => {}} open />)
    const submit = screen.getByRole('button', { name: 'Create skill' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    fill('Weekly Report', 'Does X.', 'Step one.')
    expect((submit as HTMLButtonElement).disabled).toBe(false)
  })

  it('saves: calls createSkill, bumps refresh, and closes', async () => {
    createSkillMock.mockResolvedValue({ message: 'ok', path: '/p', skill_md: 'md', success: true })
    const onOpenChange = vi.fn()
    render(<CreateSkillDialog onOpenChange={onOpenChange} open />)
    fill('Weekly Report', 'Does X.', 'Step one.')

    fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))

    await waitFor(() =>
      expect(createSkillMock).toHaveBeenCalledWith('weekly-report', expect.stringContaining('name: weekly-report'), undefined)
    )
    expect($skillsRefreshSignal.get()).toBe(1)
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('on backend error keeps the panel open and shows the detail', async () => {
    createSkillMock.mockRejectedValue(new Error('400: {"detail":"Skill \'x\' already exists."}'))
    const onOpenChange = vi.fn()
    render(<CreateSkillDialog onOpenChange={onOpenChange} open />)
    fill('X', 'Does X.', 'Step one.')

    fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))

    await waitFor(() => expect(screen.getByText("Skill 'x' already exists.")).toBeTruthy())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
