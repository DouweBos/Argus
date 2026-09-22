/**
 * Whether this browser is being driven with a real keyboard.
 *
 * Decides what the Enter key does in the composer. On a laptop it sends, like
 * the desktop app; on a phone it has to stay a newline, because a soft keyboard
 * has no Shift to reach the other behaviour with and the send button is right
 * there anyway.
 *
 * `(pointer: fine)` is the proxy: a trackpad or mouse means a hardware keyboard
 * in every setup that matters, including an iPad in a keyboard case.
 */
export function hasHardwareKeyboard(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: fine)").matches
  );
}
