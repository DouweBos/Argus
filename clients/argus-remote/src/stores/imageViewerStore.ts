/**
 * The full-screen image viewer's state. Any image in the app opens it by
 * calling `openImageViewer`; a single `<ImageViewer />` at the app root reads
 * this, so nothing has to thread modal state through the tree.
 */

import { create } from "zustand";

interface ImageViewerState {
  /** Every image in the set being viewed, so the user can page between them. */
  uris: string[];
  /** Which one is showing, or null when the viewer is closed. */
  index: number | null;
}

export const useImageViewerStore = create<ImageViewerState>(() => ({
  uris: [],
  index: null,
}));

export function openImageViewer(uris: string[], index = 0): void {
  if (uris.length === 0) {
    return;
  }
  useImageViewerStore.setState({
    uris,
    index: Math.min(Math.max(index, 0), uris.length - 1),
  });
}

export function closeImageViewer(): void {
  useImageViewerStore.setState({ uris: [], index: null });
}
