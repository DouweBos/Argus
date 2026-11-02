/**
 * Linear uploads (screenshots and screen recordings) an issue page shows
 * inline instead of as links. The TS twin of ArgusKit's `LinearMediaLink`.
 */

export interface LinearMedia {
  kind: "image" | "video";
  url: string;
  label: string;
}

const VIDEO_NAME = /\.(mov|mp4|m4v|webm)$/i;

export function isLinearUpload(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === "uploads.linear.app";
  } catch {
    return false;
  }
}

/**
 * A markdown image or link that is a Linear upload Argus can show: any image,
 * and links whose text or path names a video. Null for everything else.
 */
export function linearMediaFor(
  kind: "image" | "link",
  url: string,
  label: string,
): LinearMedia | null {
  if (!isLinearUpload(url)) {
    return null;
  }
  if (kind === "image") {
    return { kind: "image", url, label };
  }
  if (VIDEO_NAME.test(label) || VIDEO_NAME.test(new URL(url).pathname)) {
    return { kind: "video", url, label };
  }

  return null;
}
