import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { __resetLinkTitleCache } from '@/lib/external-link'
import { $previewTarget } from '@/store/preview'

import { MarkdownLink } from './markdown-text'

const desktopWindow = window as unknown as { hermesDesktop?: Window['hermesDesktop'] }
const initialHermesDesktop = desktopWindow.hermesDesktop

function installDesktopBridge() {
  const openExternal = vi.fn().mockResolvedValue(undefined)

  desktopWindow.hermesDesktop = {
    fetchLinkTitle: vi.fn().mockResolvedValue(''),
    openExternal
  } as unknown as Window['hermesDesktop']

  return openExternal
}

afterEach(() => {
  cleanup()
  __resetLinkTitleCache()
  $previewTarget.set(null)
  vi.restoreAllMocks()

  if (initialHermesDesktop) {
    desktopWindow.hermesDesktop = initialHermesDesktop
  } else {
    delete desktopWindow.hermesDesktop
  }
})

describe('MarkdownLink localhost routing', () => {
  it('opens localhost links in the preview pane instead of the browser', () => {
    const openExternal = installDesktopBridge()

    render(<MarkdownLink href="http://localhost:5000/landing.html">localhost:5000/landing.html</MarkdownLink>)

    fireEvent.click(screen.getByRole('link'))

    expect(openExternal).not.toHaveBeenCalled()
    expect($previewTarget.get()).toMatchObject({
      kind: 'url',
      url: 'http://localhost:5000/landing.html'
    })
  })

  it('routes 127.0.0.1 links to the preview pane too', () => {
    installDesktopBridge()

    render(<MarkdownLink href="http://127.0.0.1:3000">dev server</MarkdownLink>)

    fireEvent.click(screen.getByRole('link'))

    expect($previewTarget.get()).toMatchObject({ kind: 'url', url: 'http://127.0.0.1:3000' })
  })

  it('keeps non-local links opening externally', () => {
    const openExternal = installDesktopBridge()

    render(<MarkdownLink href="https://example.com/docs">example docs</MarkdownLink>)

    fireEvent.click(screen.getByRole('link'))

    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
    expect($previewTarget.get()).toBeNull()
  })

  it('modifier-click keeps the browser escape hatch for localhost links', () => {
    const openExternal = installDesktopBridge()

    render(<MarkdownLink href="http://localhost:5000/landing.html">landing</MarkdownLink>)

    fireEvent.click(screen.getByRole('link'), { metaKey: true })

    expect(openExternal).toHaveBeenCalledWith('http://localhost:5000/landing.html')
    expect($previewTarget.get()).toBeNull()
  })
})
