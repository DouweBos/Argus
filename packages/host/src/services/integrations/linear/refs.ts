/** `ENG-123`, alone or inside a Linear issue URL. */
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]{0,9}-\d+$/;
const ISSUE_URL =
  /^https?:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]{0,9}-\d+)(?:[/?#]|$)/;

/** The upper-cased identifier a ref names, or null when it names none. */
export function parseLinearRef(ref: string): string | null {
  const trimmed = ref.trim();
  if (IDENTIFIER.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  const match = ISSUE_URL.exec(trimmed);

  return match ? match[1].toUpperCase() : null;
}
