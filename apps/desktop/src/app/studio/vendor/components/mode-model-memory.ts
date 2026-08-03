// The Image studio flips between text-to-image and image-to-image models as
// soon as a reference image is added or removed. Jumping straight to the
// mode's first model each time silently threw away whatever the user had
// picked, so an upload could change the model out from under them. Remember
// the last explicit pick per mode and restore it when that mode comes back.

export interface StudioModel {
  id: string
  name: string
}

/**
 * The model to select when the studio enters a mode: the user's last explicit
 * pick in that mode when it is still on offer, otherwise the mode's first
 * model (null when the mode has no models).
 */
export function resolveModeModel<T extends StudioModel>(rememberedId: string | null | undefined, models: readonly T[]): T | null {
  const remembered = rememberedId ? models.find(model => model.id === rememberedId) : undefined

  return remembered ?? models[0] ?? null
}
