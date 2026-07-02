import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'

import { UnverifiedModelsWarning } from './model-menu-panel'

describe('UnverifiedModelsWarning', () => {
  afterEach(cleanup)

  it('renders the readiness reason text', () => {
    const rendered = render(
      <DropdownMenu open>
        <DropdownMenuContent>
          <UnverifiedModelsWarning reason="Basecamp found saved credentials on this device, but none of them can run a model right now." />
        </DropdownMenuContent>
      </DropdownMenu>
    )

    expect(
      rendered.getByText('Basecamp found saved credentials on this device, but none of them can run a model right now.')
    ).toBeDefined()
  })
})
