import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { StartChoice } from './desktop-onboarding-start-choice'

function renderChoice() {
  const onUseOpenRouter = vi.fn()
  const onConnectClaude = vi.fn()
  const onOtherProvider = vi.fn()
  const onChooseLater = vi.fn()
  const rendered = render(
    <StartChoice
      onChooseLater={onChooseLater}
      onConnectClaude={onConnectClaude}
      onOtherProvider={onOtherProvider}
      onUseOpenRouter={onUseOpenRouter}
    />
  )

  return { onChooseLater, onConnectClaude, onOtherProvider, onUseOpenRouter, rendered }
}

describe('StartChoice', () => {
  afterEach(cleanup)

  it('renders both hero cards and both escapes', () => {
    const { rendered } = renderChoice()
    expect(rendered.getByText('Use OpenRouter')).toBeDefined()
    expect(rendered.getByText('Claude subscription')).toBeDefined()
    expect(rendered.getByText('Other provider')).toBeDefined()
    expect(rendered.getByText("I'll choose a provider later")).toBeDefined()
  })

  it('fires the right callback per control', () => {
    const { onChooseLater, onConnectClaude, onOtherProvider, onUseOpenRouter, rendered } = renderChoice()
    fireEvent.click(rendered.getByText('Use OpenRouter'))
    fireEvent.click(rendered.getByText('Claude subscription'))
    fireEvent.click(rendered.getByText('Other provider'))
    fireEvent.click(rendered.getByText("I'll choose a provider later"))
    expect(onUseOpenRouter).toHaveBeenCalledOnce()
    expect(onConnectClaude).toHaveBeenCalledOnce()
    expect(onOtherProvider).toHaveBeenCalledOnce()
    expect(onChooseLater).toHaveBeenCalledOnce()
  })
})
