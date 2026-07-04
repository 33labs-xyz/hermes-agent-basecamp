import { describe, expect, it } from 'vitest'

import { forkCommand, resumeCommand } from './terminal-sessions'

describe('terminal-sessions command builders', () => {
  it('resumeCommand resumes by id', () => {
    expect(resumeCommand('abc-123')).toBe('claude --resume abc-123')
  })

  it('forkCommand branches with a fresh session id', () => {
    expect(forkCommand('from-1', 'new-2')).toBe('claude --resume from-1 --fork-session --session-id new-2')
  })
})
