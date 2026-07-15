import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Intro } from './intro'

describe('Intro', () => {
  it('renders the Basecamp brand mark on the empty chat state', () => {
    render(<Intro />)

    const mark = document.querySelector('img[src*="basecamp-mark.png"]')

    expect(mark).not.toBeNull()
  })

  it('places the brand mark above the wordmark', () => {
    render(<Intro />)

    const mark = document.querySelector('img[src*="basecamp-mark.png"]')
    const wordmark = document.querySelector('p[aria-label="BASECAMP"]')

    expect(mark).not.toBeNull()
    expect(wordmark).not.toBeNull()

    // Mark must appear before the wordmark in document order (Option A: icon on top).
    const relation = mark!.compareDocumentPosition(wordmark!)
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
