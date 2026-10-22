import type { PendingImage } from "../../../stores/conversationStore";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  extractImageFilesFromClipboard,
  filesToPendingImages,
} from "../../../lib/imageAttachments";
import { openImageViewer } from "../../../stores/imageViewerStore";

/** Images attached to a prompt that hasn't been sent yet. */
export function useImageDraft(onAttached?: () => void) {
  const [images, setImages] = useState<PendingImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  // Revoke object URLs when unmounting so previews don't leak.
  useEffect(
    () => () => {
      for (const img of imagesRef.current) {
        URL.revokeObjectURL(img.previewUrl);
      }
    },
    [],
  );

  const add = useCallback(async (files: File[]) => {
    const next = await filesToPendingImages(files);
    if (next.length > 0) {
      setImages((prev) => [...prev, ...next]);
    }
  }, []);

  const remove = useCallback((index: number) => {
    setImages((prev) => {
      const removed = prev[index];
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
      }

      return prev.filter((_, i) => i !== index);
    });
  }, []);

  /** Hand the images off — they now belong to the message, not the draft. */
  const clear = useCallback(() => setImages([]), []);

  const preview = useCallback((index: number) => {
    const img = imagesRef.current[index];
    if (img) {
      openImageViewer(
        `data:${img.attachment.media_type};base64,${img.attachment.data}`,
        img.name,
        img.previewUrl,
      );
    }
  }, []);

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = extractImageFilesFromClipboard(e);
      if (files.length > 0) {
        e.preventDefault();
        add(files);
      }
    },
    [add],
  );

  const onFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) {
        return;
      }
      await add(Array.from(files));
      e.target.value = "";
      onAttached?.();
    },
    [add, onAttached],
  );

  return {
    add,
    clear,
    fileInputRef,
    handleFileSelect: onFileSelect,
    handlePaste: onPaste,
    handlePreview: preview,
    handleRemove: remove,
    images,
  };
}
