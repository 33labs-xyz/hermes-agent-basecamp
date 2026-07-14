import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createDragDropManager, type DragDropManager } from 'dnd-core'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $studioKey, resetStudioKeyForTests } from '@/store/studio-key'

import { StudioView } from './index'

// Integration test for the internal file-tree drag path (Bug A). Renders the
// REAL StudioView + REAL vendored ImageStudio (only the network `uploadFile` is
// spied) and fires a synthetic `drop` carrying the file-tree payload the way
// tree.tsx's onDragStart writes it. This exercises the whole renderer pipeline:
//   handleDrop -> collectDrop -> readFileDataUrl (IPC) -> dataUrlToFile ->
//   isImageFile -> setDroppedFiles -> ImageStudio effect -> processDroppedImages
//   -> uploadFile
// If uploadFile is called with an image File, the renderer is correct and any
// real-app failure is isolated to native DnD delivery (which jsdom can't model).
// vi.hoisted so the spy exists before the hoisted vi.mock factory runs.
const { uploadFileMock } = vi.hoisted(() => ({
  // Typed to the real uploadFile(apiKey, file, onProgress) signature so
  // `.mock.calls[0][1]` is a File under tsc, not an out-of-bounds tuple read.
  uploadFileMock: vi.fn(
    async (_apiKey: string, _file: File, _onProgress?: (pct: number) => void) =>
      'https://cdn.example/uploaded.png'
  )
}))

// Keep every real muapi export except uploadFile, which would otherwise hit the
// network. ImageStudio imports it as `../muapi.js`; both resolve to the same
// module id, so the spy intercepts the studio's call.
vi.mock('./vendor/muapi.js', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>

  return { ...actual, uploadFile: uploadFileMock }
})
// The Library grid does its own async fetches on mount; it is irrelevant to the
// drop path, so stub it out (matches studio-ungated.test.tsx).
vi.mock('./library', () => ({ StudioLibrary: () => null }))

// A 1x1 PNG data URL - the exact shape window.hermesDesktop.readFileDataUrl
// returns for an image path.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

beforeEach(() => {
  resetStudioKeyForTests()
  uploadFileMock.mockClear()
  // A stored key keeps the Image studio ungated (no typing-trigger overlay).
  $studioKey.set('sk-live')
  ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = {
    readFileDataUrl: vi.fn(async () => PNG_DATA_URL)
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

function hermesPathsDataTransfer(path: string) {
  return {
    files: [],
    types: ['application/x-hermes-paths'],
    getData: (mime: string) =>
      mime === 'application/x-hermes-paths'
        ? JSON.stringify([{ path, isDirectory: false }])
        : ''
  }
}

describe('StudioView internal drag-to-upload', () => {
  it('uploads a png dragged from the file tree into the active studio', async () => {
    render(<StudioView setStatusbarItemGroup={vi.fn()} />)

    const pane = await waitFor(() => {
      const found = document.querySelector('[data-studio-pane]:not([hidden])')

      if (!found) {throw new Error('no visible studio pane')}

      return found as HTMLElement
    })

    fireEvent.drop(pane, { dataTransfer: hermesPathsDataTransfer('/abs/pic.png') })

    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledTimes(1))

    const file = uploadFileMock.mock.calls[0][1] as File

    expect(file.type).toBe('image/png')
    expect(file.name).toBe('pic.png')
  })
})

// Root-cause reproduction for Bug A. The renderer pipeline above is correct, so
// the real-app failure lives one layer lower: the file tree
// (right-sidebar/files) mounts react-arborist with a shared HTML5Backend (see
// files/dnd-manager.ts). That backend's setup() attaches a global window
// `dragover` listener (handleTopDragOver) that forces
// `dataTransfer.dropEffect = 'none'` whenever no react-dnd drag is active -
// which is ALWAYS true for the file tree's native drag, because arborist runs
// with `disableDrag` so the drag is never a react-dnd source. That listener
// fires AFTER the studio drop zone's own onDragOver (React delegates at the
// root container, which is inside window), overriding `copy` back to `none`.
// A final dropEffect of `none` makes the browser suppress the `drop` event
// entirely, so Studio's onDrop never runs and nothing uploads.
//
// jsdom can't model the browser's drop-suppression, but preserving `copy` past
// the window handler is the exact contract the real drop is gated on, so this
// asserts that instead.
describe('StudioView native-drag dropEffect (Bug A root cause)', () => {
  let backend: ReturnType<DragDropManager['getBackend']>

  beforeEach(() => {
    // Mount the same backend the file tree does, so its window `dragover`
    // handler is live exactly as it is in the real app.
    const manager = createDragDropManager(HTML5Backend)

    backend = manager.getBackend()
    backend.setup()
  })

  afterEach(() => {
    // Remove the window listeners and release the __isReactDndHtml5Backend flag.
    backend.teardown()
  })

  it('keeps dropEffect=copy over the studio pane despite the file-tree HTML5Backend', async () => {
    render(<StudioView setStatusbarItemGroup={vi.fn()} />)

    const pane = await waitFor(() => {
      const found = document.querySelector('[data-studio-pane]:not([hidden])')

      if (!found) {throw new Error('no visible studio pane')}

      return found as HTMLElement
    })

    // A mutable stand-in for the native DataTransfer: both the studio zone's
    // onDragOver and the window handler mutate this same object.
    const dataTransfer = {
      dropEffect: 'none',
      effectAllowed: 'all',
      files: [] as File[],
      types: ['application/x-hermes-paths'],
      getData: () => '',
      setData: () => {}
    }

    fireEvent.dragOver(pane, { dataTransfer })

    // Without the fix the window backend clobbers this to 'none'; the studio
    // zone must stop the event before it reaches window so the drop survives.
    expect(dataTransfer.dropEffect).toBe('copy')
  })
})
