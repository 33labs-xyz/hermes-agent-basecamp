import { describe, expect, it } from 'vitest'

import { foldersPaneEnabled } from './routes'

describe('foldersPaneEnabled', () => {
  it('enables the folders rail in chat', () => {
    expect(foldersPaneEnabled(true, 'chat')).toBe(true)
  })

  it('enables the folders rail on the Studio screen even when chat is closed', () => {
    // Studio users open the rail to browse folders and drag images into a studio.
    expect(foldersPaneEnabled(false, 'studio')).toBe(true)
  })

  it('keeps the folders rail disabled on overlay views like settings', () => {
    expect(foldersPaneEnabled(false, 'settings')).toBe(false)
  })

  it('keeps the folders rail disabled on other full-page views like staff', () => {
    expect(foldersPaneEnabled(false, 'staff')).toBe(false)
  })
})
