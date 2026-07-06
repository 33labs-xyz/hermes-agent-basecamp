import { useCallback, useEffect, useState } from 'react'

import type { StudioGenerationEntry } from '@/global'
import { notifyError } from '@/store/notifications'

// Shared access to the local generation library. Owns the list + the mutation
// verbs (archive-first delete, restore, permanent delete, foldering, organise)
// so both the Studio Library tab and the Artifacts source render from one place.
//
// Every verb is called fire-and-forget from the UI (`void archive(id)` etc.),
// so failures here must be caught and surfaced via notify — an uncaught
// rejection would otherwise silently no-op with no feedback to the user.
export function useGenerations(refreshKey = 0) {
  const [entries, setEntries] = useState<StudioGenerationEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const gen = window.hermesDesktop?.studio?.gen

    if (!gen) {
      setEntries([])
      setLoading(false)

      return
    }

    setLoading(true)

    try {
      setEntries(await gen.list())
    } catch (error) {
      notifyError(error, 'Failed to load generations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  const archive = useCallback(
    async (id: string) => {
      try {
        await window.hermesDesktop?.studio?.gen.archive(id)
        await refresh()
      } catch (error) {
        notifyError(error, 'Failed to archive generation')
      }
    },
    [refresh]
  )

  const restore = useCallback(
    async (id: string) => {
      try {
        await window.hermesDesktop?.studio?.gen.restore(id)
        await refresh()
      } catch (error) {
        notifyError(error, 'Failed to restore generation')
      }
    },
    [refresh]
  )

  const deleteForever = useCallback(
    async (id: string) => {
      try {
        await window.hermesDesktop?.studio?.gen.deleteForever(id)
        await refresh()
      } catch (error) {
        notifyError(error, 'Failed to delete generation')
      }
    },
    [refresh]
  )

  const setFolder = useCallback(
    async (id: string, folder: string) => {
      try {
        await window.hermesDesktop?.studio?.gen.setFolder(id, folder)
        await refresh()
      } catch (error) {
        notifyError(error, 'Failed to move generation')
      }
    },
    [refresh]
  )

  const organise = useCallback(async () => {
    try {
      await window.hermesDesktop?.studio?.gen.organise()
      await refresh()
    } catch (error) {
      notifyError(error, 'Failed to organise generations')
    }
  }, [refresh])

  return { entries, loading, refresh, archive, restore, deleteForever, setFolder, organise }
}

// Load an on-disk generation as a data URL for inline preview. Returns '' when
// unavailable (missing bridge or unreadable file).
export async function loadGenerationDataUrl(filePath: string | undefined): Promise<string> {
  if (!filePath) {return ''}

  try {
    return (await window.hermesDesktop?.readFileDataUrl(filePath)) ?? ''
  } catch {
    return ''
  }
}
