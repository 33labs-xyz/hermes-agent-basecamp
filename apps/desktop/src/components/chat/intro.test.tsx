import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Intro } from './intro'

describe('Intro', () => {
  it('does not render the app-icon brand mark on the empty chat state', () => {
    render(<Intro />)

    const mark = document.querySelector('img[src*="basecamp-mark.png"]')

    expect(mark).toBeNull()
  })

  it('renders the BASECAMP wordmark in the Poppins geometric face', () => {
    render(<Intro />)

    const wordmark = document.querySelector('p[aria-label="BASECAMP"]')

    expect(wordmark).not.toBeNull()
    expect(wordmark!.className).toContain("font-['Poppins']")
  })
})
