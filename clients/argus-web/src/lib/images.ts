/**
 * Browser image-attachment helpers: turn pasted/dropped/picked files into
 * base64 `RemoteImageAttachment`s (plus an object-URL preview) for `agents.send`.
 */

import type { RemoteImageAttachment } from "./protocol";

export const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp";

export interface PendingImage {
  name: string;
  previewUrl: string;
  attachment: RemoteImageAttachment;
}

function fileToAttachment(file: File): Promise<PendingImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const result = String(reader.result);
      // Strip the `data:<type>;base64,` prefix — the wire wants raw base64.
      const data = result.slice(result.indexOf(",") + 1);
      resolve({
        name: file.name || "image",
        previewUrl: URL.createObjectURL(file),
        attachment: { data, media_type: file.type || "image/png" },
      });
    };
    reader.readAsDataURL(file);
  });
}

export async function filesToPendingImages(files: File[]): Promise<PendingImage[]> {
  const images = files.filter((f) => f.type.startsWith("image/"));

  return Promise.all(images.map(fileToAttachment));
}

export function extractImageFilesFromClipboard(
  e: React.ClipboardEvent,
): File[] {
  const out: File[] = [];
  for (const item of Array.from(e.clipboardData?.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        out.push(file);
      }
    }
  }

  return out;
}
