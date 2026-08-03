import { describe, expect, it } from 'vitest'

import { resolveModeModel } from './mode-model-memory'

const MODELS = [
  { id: 'first', name: 'First' },
  { id: 'second', name: 'Second' }
]

describe('resolveModeModel', () => {
  it('keeps the model the user last picked in this mode', () => {
    expect(resolveModeModel('second', MODELS)).toEqual({ id: 'second', name: 'Second' })
  })

  it('falls back to the first model when nothing was picked yet', () => {
    expect(resolveModeModel(null, MODELS)).toEqual({ id: 'first', name: 'First' })
  })

  it('falls back to the first model when the remembered pick is no longer offered', () => {
    expect(resolveModeModel('retired-model', MODELS)).toEqual({ id: 'first', name: 'First' })
  })

  it('returns null when the mode has no models at all', () => {
    expect(resolveModeModel('second', [])).toBeNull()
  })
})
