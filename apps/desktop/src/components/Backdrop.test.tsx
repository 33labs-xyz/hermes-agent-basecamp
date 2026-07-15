import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Backdrop } from './Backdrop'

describe('Backdrop', () => {
  it('does not render the statue background image by default', () => {
    render(<Backdrop />)

    const statue = document.querySelector('img[src*="filler-bg0.jpg"]')

    expect(statue).toBeNull()
  })
})
