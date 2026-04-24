import type { PendingImage } from "../stores/conversationStore";

export const ACCEPTED_IMAGE_TYPES = "image/png,image/jpeg,image/gif,image/webp";

/** Read a File as base64 (without the data-URL prefix). */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Convert File objects to PendingImage records. Non-image files are skipped. */
export async function filesToPendingImages(
  files: File[],
): Promise<PendingImage[]> {
  const out: PendingImage[] = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      continue;
    }
    const data = await readFileAsBase64(file);
    out.push({
      name: file.name || "pasted-image",
      previewUrl: URL.createObjectURL(file),
      attachment: { data, media_type: file.type },
    });
  }

  return out;
}

/** Pull any image files out of a clipboard event's items. */
export function extractImageFilesFromClipboard(
  e: React.ClipboardEvent,
): File[] {
  const items = e.clipboardData?.items;
  if (!items) {
    return [];
  }
  const out: File[] = [];
  for (const item of Array.from(items)) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        out.push(file);
      }
    }
  }

  return out;
}
