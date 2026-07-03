import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $connection } from '@/store/session'

import { PreviewPane } from './preview-pane'

function urlTarget(url = 'http://localhost:5174') {
  return {
    kind: 'url' as const,
    label: 'Preview',
    source: url,
    url
  }
}

describe('PreviewPane console state', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
  })

  afterEach(() => {
    cleanup()
    $connection.set(null)
    vi.unstubAllGlobals()
  })

  it('does not watch backend-only remote filesystem previews locally', () => {
    const watchPreviewFile = vi.fn(async () => ({ id: 'watch-1', path: '/remote/file.txt' }))
    const onPreviewFileChanged = vi.fn(() => vi.fn())
    $connection.set({ mode: 'remote' } as never)
    vi.stubGlobal('window', {
      ...window,
      hermesDesktop: {
        onPreviewFileChanged,
        watchPreviewFile
      }
    })

    render(
      <PreviewPane
        setTitlebarToolGroup={vi.fn()}
        target={{
          kind: 'file',
          label: 'file.txt',
          path: '/remote/file.txt',
          previewKind: 'text',
          source: '/remote/file.txt',
          url: 'file:///remote/file.txt'
        }}
      />
    )

    expect(watchPreviewFile).not.toHaveBeenCalled()
    expect(onPreviewFileChanged).not.toHaveBeenCalled()
  })

  it('does not rebuild the pane titlebar group for streamed console logs', () => {
    const setTitlebarToolGroup = vi.fn()

    const rendered = render(
      <PreviewPane
        setTitlebarToolGroup={setTitlebarToolGroup}
        target={{
          kind: 'url',
          label: 'Preview',
          source: 'http://localhost:5174',
          url: 'http://localhost:5174'
        }}
      />
    )

    const initialCalls = setTitlebarToolGroup.mock.calls.length
    const webview = rendered.container.querySelector('webview')

    expect(webview).toBeInstanceOf(HTMLElement)

    act(() => {
      webview?.dispatchEvent(
        Object.assign(new Event('console-message'), {
          level: 0,
          message: 'streamed log line',
          sourceId: 'http://localhost:5174/src/main.tsx'
        })
      )
    })

    expect(setTitlebarToolGroup).toHaveBeenCalledTimes(initialCalls)
  })
})

describe('PreviewPane device switcher', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('offers desktop, tablet and mobile viewports for web previews', () => {
    render(<PreviewPane target={urlTarget()} />)

    expect(screen.getByRole('button', { name: 'Desktop' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tablet' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mobile' })).toBeTruthy()
  })

  it('hides the device switcher for file previews', () => {
    render(
      <PreviewPane
        target={{
          kind: 'file',
          label: 'file.txt',
          path: '/tmp/file.txt',
          previewKind: 'text',
          source: '/tmp/file.txt',
          url: 'file:///tmp/file.txt'
        }}
      />
    )

    expect(screen.queryByRole('button', { name: 'Tablet' })).toBeNull()
  })

  it('constrains the webview to the chosen device width and releases it on desktop', () => {
    const rendered = render(<PreviewPane target={urlTarget()} />)
    const webview = rendered.container.querySelector('webview') as HTMLElement

    expect(webview).toBeInstanceOf(HTMLElement)
    expect(webview.style.width).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }))

    expect(webview.style.width).toBe('390px')
    expect(webview.style.maxWidth).toBe('100%')
    expect(webview.style.flex).toBe('0 0 auto')

    fireEvent.click(screen.getByRole('button', { name: 'Tablet' }))

    expect(webview.style.width).toBe('768px')

    fireEvent.click(screen.getByRole('button', { name: 'Desktop' }))

    expect(webview.style.width).toBe('')
    expect(webview.style.flex).toBe('')
  })

  it('keeps the chosen device when the preview navigates to a new target', () => {
    const rendered = render(<PreviewPane target={urlTarget()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Mobile' }))

    rendered.rerender(<PreviewPane target={urlTarget('http://localhost:3000')} />)

    const webview = rendered.container.querySelector('webview') as HTMLElement

    expect(webview.style.width).toBe('390px')
  })
})
