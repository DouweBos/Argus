import { requireOptionalNativeModule } from "expo-modules-core";
import type { EventSubscription } from "expo-modules-core";

export interface PastedImage {
  /** Base64 PNG, no data-URI prefix. */
  data: string;
  mediaType: string;
}

interface ArgusPasteModule {
  addListener: (
    event: "onPasteImage",
    listener: (payload: PastedImage) => void,
  ) => EventSubscription;
}

// iOS-only: Android's paste already goes through the keyboard's own handling.
const native = requireOptionalNativeModule<ArgusPasteModule>("ArgusPaste");

/** Called when the user pastes an image into a focused text input. */
export function addImagePasteListener(
  listener: (image: PastedImage) => void,
): () => void {
  const subscription = native?.addListener("onPasteImage", listener);

  return () => subscription?.remove();
}
