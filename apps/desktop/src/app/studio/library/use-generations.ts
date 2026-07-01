import { useCallback, useEffect, useState } from 'react'

import type { StudioGenerationEntry } from '@/global'

// Shared access to the local generation library. Owns the list + the mutation
// verbs (archive-first delete, restore, permanent delete, foldering, organise)
// so both the Studio Library tab and the Artifacts source render from one place.
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
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  const archive = useCallback(
    async (id: string) => {
      await window.hermesDesktop?.studio?.gen.archive(id)
      await refresh()
    },
    [refresh]
  )

  const restore = useCallback(
    async (id: string) => {
      await window.hermesDesktop?.studio?.gen.restore(id)
      await refresh()
    },
    [refresh]
  )

  const deleteForever = useCallback(
    async (id: string) => {
      await window.hermesDesktop?.studio?.gen.deleteForever(id)
      await refresh()
    },
    [refresh]
  )

  const setFolder = useCallback(
    async (id: string, folder: string) => {
      await window.hermesDesktop?.studio?.gen.setFolder(id, folder)
      await refresh()
    },
    [refresh]
  )

  const organise = useCallback(async () => {
    await window.hermesDesktop?.studio?.gen.organise()
    await refresh()
  }, [refresh])

  return { entries, loading, refresh, archive, restore, deleteForever, setFolder, organise }
}

// Load an on-disk generation as a data URL for inline preview. Returns '' when
// unavailable (missing bridge or unreadable file).
export async function loadGenerationDataUrl(filePath: string | undefined): Promise<string> {
  if (!filePath) return ''

  try {
    return (await window.hermesDesktop?.readFileDataUrl(filePath)) ?? ''
  } catch {
    return ''
  }
}
