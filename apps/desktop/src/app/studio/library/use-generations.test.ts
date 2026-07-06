import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $notifications, clearNotifications } from '@/store/notifications'

import { useGenerations } from './use-generations'

const list = vi.fn()
const archive = vi.fn()
const restore = vi.fn()
const deleteForever = vi.fn()
const setFolder = vi.fn()
const organise = vi.fn()

function entry(id: string) {
  return {
    id,
    ext: 'png',
    kind: 'image' as const,
    folder: 'root',
    prompt: 'a cat',
    model: 'nano-banana',
    tab: 'image',
    sourceUrl: 'https://example.com/a.png',
    createdAt: '2026-01-01T00:00:00.000Z',
    archived: false
  }
}

beforeEach(() => {
  list.mockReset().mockResolvedValue([entry('1')])
  archive.mockReset()
  restore.mockReset()
  deleteForever.mockReset()
  setFolder.mockReset()
  organise.mockReset()
  ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = {
    studio: { gen: { list, archive, restore, deleteForever, setFolder, organise } }
  }
  clearNotifications()
})

afterEach(() => {
  cleanup()
  clearNotifications()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

describe('useGenerations', () => {
  it('loads entries on mount', async () => {
    const { result } = renderHook(() => useGenerations())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.entries).toEqual([entry('1')])
  })

  it('surfaces a notification and stops loading when refresh() rejects', async () => {
    list.mockReset().mockRejectedValue(new Error('disk read failed'))

    const { result } = renderHook(() => useGenerations())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect($notifications.get()).toHaveLength(1)
    expect($notifications.get()[0].kind).toBe('error')
  })

  it('surfaces a notification when archive() rejects, without throwing', async () => {
    archive.mockReset().mockRejectedValue(new Error('archive failed'))

    const { result } = renderHook(() => useGenerations())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await expect(result.current.archive('1')).resolves.not.toThrow()
    })

    expect($notifications.get()).toHaveLength(1)
    expect($notifications.get()[0].kind).toBe('error')
  })

  it('surfaces a notification when restore() rejects, without throwing', async () => {
    restore.mockReset().mockRejectedValue(new Error('restore failed'))

    const { result } = renderHook(() => useGenerations())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await expect(result.current.restore('1')).resolves.not.toThrow()
    })

    expect($notifications.get()).toHaveLength(1)
  })

  it('surfaces a notification when deleteForever() rejects, without throwing', async () => {
    deleteForever.mockReset().mockRejectedValue(new Error('delete failed'))

    const { result } = renderHook(() => useGenerations())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await expect(result.current.deleteForever('1')).resolves.not.toThrow()
    })

    expect($notifications.get()).toHaveLength(1)
  })

  it('surfaces a notification when setFolder() rejects, without throwing', async () => {
    setFolder.mockReset().mockRejectedValue(new Error('setFolder failed'))

    const { result } = renderHook(() => useGenerations())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await expect(result.current.setFolder('1', 'new-folder')).resolves.not.toThrow()
    })

    expect($notifications.get()).toHaveLength(1)
  })

  it('surfaces a notification when organise() rejects, without throwing', async () => {
    organise.mockReset().mockRejectedValue(new Error('organise failed'))

    const { result } = renderHook(() => useGenerations())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await expect(result.current.organise()).resolves.not.toThrow()
    })

    expect($notifications.get()).toHaveLength(1)
  })
})
