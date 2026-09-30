import path from "node:path";

/** File extension for an image source: its data-URL MIME type, else the name's. */
export function inferImageExt(src: string, fallbackName: string): string {
  const m = src.match(/^data:image\/([a-zA-Z0-9+.-]+);/);
  if (m) {
    const t = m[1].toLowerCase();

    return t === "jpeg" ? "jpg" : t;
  }
  const ext = path.extname(fallbackName).replace(".", "").toLowerCase();

  return ext || "png";
}

/** `name` with `ext` appended unless it already has an extension. */
export function ensureExt(name: string, ext: string): string {
  return path.extname(name) ? name : `${name}.${ext}`;
}
