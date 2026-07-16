import { describe, expect, it } from 'vitest'

import { isSessionNotFoundError } from './session-errors'

describe('isSessionNotFoundError', () => {
  it('matches the IPC-formatted 404 error', () => {
    expect(isSessionNotFoundError(new Error('404: {"detail":"Session not found"}'))).toBe(true)
  })

  it('matches a bare backend detail string', () => {
    expect(isSessionNotFoundError(new Error('Session not found'))).toBe(true)
  })

  it('matches a raw string payload', () => {
    expect(isSessionNotFoundError('Session not found')).toBe(true)
  })

  it('does not match other server errors', () => {
    expect(isSessionNotFoundError(new Error('500: Internal Server Error'))).toBe(false)
  })

  it('does not match unrelated errors', () => {
    expect(isSessionNotFoundError(new Error('network down'))).toBe(false)
  })

  it('is false for null / undefined', () => {
    expect(isSessionNotFoundError(null)).toBe(false)
    expect(isSessionNotFoundError(undefined)).toBe(false)
  })
})
