export interface FigmaRef {
  fileKey: string;
  /** API form, `12:34`. Null when the link points at the whole file. */
  nodeId: string | null;
}

const FILE_URL =
  /^https?:\/\/(?:www\.)?figma\.com\/(?:design|file|proto|board)\/([A-Za-z0-9]+)(?:\/[^?#]*)?(?:\?([^#]*))?/;

/** The file and frame a figma.com link points at, or null for anything else. */
export function parseFigmaUrl(url: string): FigmaRef | null {
  const match = FILE_URL.exec(url.trim());
  if (!match) {
    return null;
  }
  const nodeParam = new URLSearchParams(match[2] ?? "").get("node-id");

  // Links carry `12-34`; the API wants `12:34`.
  return {
    fileKey: match[1],
    nodeId: nodeParam ? nodeParam.replaceAll("-", ":") : null,
  };
}
