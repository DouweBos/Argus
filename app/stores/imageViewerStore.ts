import { create } from "zustand";

interface ImageViewerState {
  alt: string;
  fallbackSrc: string | null;
  src: string | null;
}

const imageViewerStore = create<ImageViewerState>(() => ({
  alt: "",
  fallbackSrc: null,
  src: null,
}));

export const openImageViewer = (
  src: string,
  alt: string,
  fallbackSrc?: string,
) => {
  imageViewerStore.setState({ src, alt, fallbackSrc: fallbackSrc ?? null });
};

export const closeImageViewer = () => {
  imageViewerStore.setState({ src: null, alt: "", fallbackSrc: null });
};

export const useImageViewerSrc = () => imageViewerStore((s) => s.src);
export const useImageViewerAlt = () => imageViewerStore((s) => s.alt);
export const useImageViewerFallbackSrc = () =>
  imageViewerStore((s) => s.fallbackSrc);
