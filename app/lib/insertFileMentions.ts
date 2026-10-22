/**
 * Insert `@path` mentions at the caret of a prompt box, escaping spaces the
 * way the mention parser expects, and leave the caret after them.
 */
export function insertFileMentions(
  el: HTMLTextAreaElement | null,
  paths: string[],
  setValue: (next: string) => void,
): void {
  if (!el || paths.length === 0) {
    return;
  }
  const cursor = el.selectionStart ?? el.value.length;
  const before = el.value.slice(0, cursor);
  const after = el.value.slice(cursor);
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
  const mentions = paths.map((p) => `@${p.replace(/ /g, "\\ ")}`).join(" ");
  const insertion = `${needsLeadingSpace ? " " : ""}${mentions} `;
  setValue(`${before}${insertion}${after}`);
  requestAnimationFrame(() => {
    const caret = before.length + insertion.length;
    el.selectionStart = caret;
    el.selectionEnd = caret;
    el.focus();
  });
}
