import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// uploadFile hits the network; stub the whole vendor muapi module.
vi.mock('../muapi.js', () => ({
  uploadFile: vi.fn(),
  generateImage: vi.fn(),
  generateI2I: vi.fn(),
}))

import { uploadFile } from '../muapi.js'
// @ts-expect-error - vendor JSX module has no type declarations (allowJs:false); typing it is out of scope.
import { UploadButton } from './ImageStudio.jsx'

const SAVED_IMAGE = {
  id: 'g1',
  ext: 'png',
  kind: 'image',
  folder: '',
  prompt: 'a cat',
  model: '',
  tab: '',
  sourceUrl: '',
  createdAt: '2026-07-04T10:00:00.000Z',
  archived: false,
  path: '/lib/g1.png',
}

beforeEach(() => {
  vi.mocked(uploadFile).mockReset()
  // Minimal desktop bridge: Library list + on-disk read.
  ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = {
    studio: { gen: { list: vi.fn().mockResolvedValue([SAVED_IMAGE]) } },
    readFileDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,iVBORw0KGgo='),
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

// Open the picker panel (single-select trigger title is "Reference image").
function openPanel() {
  fireEvent.click(screen.getByTitle('Reference image'))
}

describe('UploadButton Library source', () => {
  it('shows saved Library thumbnails when the panel opens', async () => {
    render(<UploadButton apiKey="k" maxImages={1} onSelect={vi.fn()} onClear={vi.fn()} />)
    openPanel()

    expect(await screen.findByLabelText('Use a cat')).toBeTruthy()
  })

  it('toggles from Library to the empty Uploads grid', async () => {
    render(<UploadButton apiKey="k" maxImages={1} onSelect={vi.fn()} onClear={vi.fn()} />)
    openPanel()
    await screen.findByLabelText('Use a cat') // Library is the default when uploads are empty

    fireEvent.click(screen.getByRole('button', { name: 'Uploads' }))

    expect(screen.getByText('No uploads yet')).toBeTruthy()
  })

  it('re-uploads the file and fires onSelect when a Library image is picked', async () => {
    vi.mocked(uploadFile).mockResolvedValue('https://signed/g1')
    const onSelect = vi.fn()
    render(<UploadButton apiKey="k" maxImages={1} onSelect={onSelect} onClear={vi.fn()} />)
    openPanel()

    fireEvent.click(await screen.findByLabelText('Use a cat'))

    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://signed/g1', urls: ['https://signed/g1'], thumbnail: 'https://signed/g1' }),
      ),
    )
  })

  it('does not fire onSelect when the re-upload fails', async () => {
    vi.mocked(uploadFile).mockRejectedValue(new Error('nope'))
    const onSelect = vi.fn()
    render(<UploadButton apiKey="k" maxImages={1} onSelect={onSelect} onClear={vi.fn()} />)
    openPanel()

    fireEvent.click(await screen.findByLabelText('Use a cat'))

    await waitFor(() => expect(uploadFile).toHaveBeenCalled())
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows empty Library state when the Studio bridge is absent', async () => {
    // Override bridge so studio is undefined for this case; restore via afterEach.
    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = {
      studio: undefined,
      readFileDataUrl: vi.fn(),
    }

    render(<UploadButton apiKey="k" maxImages={1} onSelect={vi.fn()} onClear={vi.fn()} />)
    openPanel()

    expect(await screen.findByText('No saved images yet')).toBeTruthy()
  })
})
