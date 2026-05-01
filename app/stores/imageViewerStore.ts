import { create } from "zustand";

export interface ImageCropResult {
  /** Base64-encoded image data, no data-URL prefix. */
  data: string;
  mediaType: string;
  /** Object URL for the cropped image (caller is responsible for revoking). */
  previewUrl: string;
}

interface ImageViewerState {
  alt: string;
  fallbackSrc: string | null;
  /**
   * When set, the viewer renders a Crop affordance. Receives the cropped
   * result so the caller can replace the source attachment.
   */
  onCrop: ((result: ImageCropResult) => void) | null;
  src: string | null;
}

const imageViewerStore = create<ImageViewerState>(() => ({
  alt: "",
  fallbackSrc: null,
  onCrop: null,
  src: null,
}));

export const openImageViewer = (
  src: string,
  alt: string,
  fallbackSrc?: string,
  onCrop?: (result: ImageCropResult) => void,
) => {
  imageViewerStore.setState({
    src,
    alt,
    fallbackSrc: fallbackSrc ?? null,
    onCrop: onCrop ?? null,
  });
};

export const closeImageViewer = () => {
  imageViewerStore.setState({
    src: null,
    alt: "",
    fallbackSrc: null,
    onCrop: null,
  });
};

export const useImageViewerSrc = () => imageViewerStore((s) => s.src);
export const useImageViewerAlt = () => imageViewerStore((s) => s.alt);
export const useImageViewerFallbackSrc = () =>
  imageViewerStore((s) => s.fallbackSrc);
export const useImageViewerOnCrop = () => imageViewerStore((s) => s.onCrop);
