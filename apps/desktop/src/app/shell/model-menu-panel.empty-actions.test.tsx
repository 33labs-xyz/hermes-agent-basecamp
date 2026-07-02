import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'

import { EmptyModelActions } from './model-menu-panel'

function renderActions() {
  const onConnectClaude = vi.fn()
  const onUseOpenRouter = vi.fn()

  const rendered = render(
    <DropdownMenu open>
      <DropdownMenuContent>
        <EmptyModelActions
          copy={{ connectClaude: 'Connect Claude subscription', useOpenRouter: 'Use OpenRouter' }}
          onConnectClaude={onConnectClaude}
          onUseOpenRouter={onUseOpenRouter}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return { onConnectClaude, onUseOpenRouter, rendered }
}

describe('EmptyModelActions', () => {
  afterEach(cleanup)

  it('renders both quick actions', () => {
    const { rendered } = renderActions()
    expect(rendered.getByText('Use OpenRouter')).toBeDefined()
    expect(rendered.getByText('Connect Claude subscription')).toBeDefined()
  })

  it('fires the matching handler on select', () => {
    const { onConnectClaude, onUseOpenRouter, rendered } = renderActions()
    fireEvent.click(rendered.getByText('Use OpenRouter'))
    expect(onUseOpenRouter).toHaveBeenCalledOnce()
    fireEvent.click(rendered.getByText('Connect Claude subscription'))
    expect(onConnectClaude).toHaveBeenCalledOnce()
  })
})
