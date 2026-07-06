// Deletability rules for Artifacts tiles. Pure + unit-tested so the UI wiring
// stays a thin call. Mirrors the standalone-module precedent of
// filter-existing-artifacts.ts (#148); the artifact shape is duck-typed here
// rather than importing ArtifactRecord to keep the module dependency-free.
export interface DeletableArtifact {
  id: string
  kind: 'image' | 'file' | 'link'
  value: string
  source?: 'session' | 'studio'
}

export type ArtifactDeletionPlan =
  | { kind: 'studio'; genId: string }
  | { kind: 'file'; path: string }
  | null

// Only absolute-resolvable local paths. Relative paths (./x, ../x) cannot be
// resolved to a disk path without a session cwd, so they are NOT deletable
// (the main-side guard would reject them anyway). This is intentionally
// stricter than artifactKind's file detection.
export function isLocallyDeletable(value: string): boolean {
  return (
    value.startsWith('/') ||
    value.startsWith('~/') ||
    value.startsWith('file://')
  )
}

// True only when the main-side delete IPC positively confirmed success.
// A missing bridge (undefined) or an explicit { ok: false } is NOT success,
// so the caller must not optimistically remove the tile. Shape matches the
// deleteArtifactFile bridge return type (global.d.ts): { ok, error? }.
export function isFileDeleteOk(res: { ok?: boolean; error?: string } | undefined | null): boolean {
  return res?.ok === true
}

export function planArtifactDeletion(artifact: DeletableArtifact): ArtifactDeletionPlan {
  if (artifact.source === 'studio') {
    const prefix = 'studio:'
    if (artifact.id.startsWith(prefix)) {
      const genId = artifact.id.slice(prefix.length)
      if (genId) return { kind: 'studio', genId }
    }
    return null
  }
  if ((artifact.kind === 'file' || artifact.kind === 'image') && isLocallyDeletable(artifact.value)) {
    return { kind: 'file', path: artifact.value }
  }
  return null
}
