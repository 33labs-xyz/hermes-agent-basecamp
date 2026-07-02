import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'

import { ProviderGroupLabel } from './model-menu-panel'

function renderLabel(authenticated: boolean | undefined) {
  return render(
    <DropdownMenu open>
      <DropdownMenuContent>
        <ProviderGroupLabel authenticated={authenticated} name="Ollama Cloud" notConnectedLabel="Not connected" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

describe('ProviderGroupLabel', () => {
  afterEach(cleanup)

  it('tags an unauthenticated provider with the not-connected label', () => {
    const rendered = renderLabel(false)

    expect(rendered.getByText('Ollama Cloud')).toBeDefined()
    expect(rendered.getByText('Not connected')).toBeDefined()
  })

  it('shows only the name when the provider is authenticated', () => {
    const rendered = renderLabel(true)

    expect(rendered.getByText('Ollama Cloud')).toBeDefined()
    expect(rendered.queryByText('Not connected')).toBeNull()
  })

  it('shows only the name when the backend omits the flag', () => {
    const rendered = renderLabel(undefined)

    expect(rendered.getByText('Ollama Cloud')).toBeDefined()
    expect(rendered.queryByText('Not connected')).toBeNull()
  })
})
