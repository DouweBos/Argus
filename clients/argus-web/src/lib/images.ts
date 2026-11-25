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

/** Text pasted beside images, unless it only names them: a copied file's name or an image's URL. */
export function textBesideImages(
  text: string,
  names: string[],
): string | null {
  const known = new Set(names.map((n) => n.trim()));
  const lines = text
    .split(/\r?\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines.length === 0 || lines.every((l) => known.has(l)) ? null : text;
}

/** Whether a paste that attaches `images` should still let the browser insert its text. */
export function clipboardKeepsText(
  e: React.ClipboardEvent,
  images: File[],
): boolean {
  const data = e.clipboardData;
  if (!data) {
    return false;
  }
  const urls = data.getData("text/uri-list").split(/\r?\n/);

  return (
    textBesideImages(data.getData("text/plain"), [
      ...images.map((f) => f.name),
      ...urls,
    ]) !== null
  );
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
