import { useEffect } from "react";

/**
 * Chromium/Electron scroll the nearest scrollable ancestor on Space. Argus
 * uses Space for actions (e.g. git staging); we suppress that default globally
 * while leaving Space to real text fields and common native Space semantics.
 */
export function useSuppressSpacePageScroll(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== " " && e.code !== "Space") {
        return;
      }
      if (e.defaultPrevented) {
        return;
      }
      // Let modified Space chords through for shortcuts / IME (except Shift+Space scroll-up).
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      if (spaceTargetAllowsBrowserDefault(e)) {
        return;
      }
      e.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

function spaceTargetAllowsBrowserDefault(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof Element)) {
    return false;
  }

  // Plain form controls: never intercept space. Checked first via
  // tagName so a role="treeitem" or role="button" ancestor lower in the
  // allowlist can't accidentally override a real <input>.
  if (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement
  ) {
    return true;
  }

  if (t instanceof HTMLElement && t.isContentEditable) {
    return true;
  }

  const formOrEditable = t.closest(
    "input, textarea, select, option, [contenteditable='true'], [contenteditable='plaintext-only']",
  );
  if (formOrEditable) {
    return true;
  }

  // The terminal handles Space itself (typing). The focused element may be a
  // wrapper rather than the inner textarea, so match the terminal root directly.
  if (t.closest(".xterm")) {
    return true;
  }

  // Native Space: activate control / follow link / toggle details / menus
  if (
    t.closest(
      'button, a[href], summary, label, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="switch"], [role="tab"], [role="treeitem"]',
    )
  ) {
    return true;
  }

  return false;
}
