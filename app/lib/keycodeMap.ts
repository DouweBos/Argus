/// Maps `KeyboardEvent.code` values to macOS virtual keycodes.

export const KEYCODE_MAP: Record<string, number> = {
  // Letters
  KeyA: 0,
  KeyS: 1,
  KeyD: 2,
  KeyF: 3,
  KeyH: 4,
  KeyG: 5,
  KeyZ: 6,
  KeyX: 7,
  KeyC: 8,
  KeyV: 9,
  KeyB: 11,
  KeyQ: 12,
  KeyW: 13,
  KeyE: 14,
  KeyR: 15,
  KeyY: 16,
  KeyT: 17,
  KeyU: 32,
  KeyI: 34,
  KeyP: 35,
  KeyL: 37,
  KeyJ: 38,
  KeyK: 40,
  KeyO: 31,
  KeyN: 45,
  KeyM: 46,

  // Digits
  Digit1: 18,
  Digit2: 19,
  Digit3: 20,
  Digit4: 21,
  Digit5: 23,
  Digit6: 22,
  Digit7: 26,
  Digit8: 28,
  Digit9: 25,
  Digit0: 29,

  // Punctuation / symbols
  Minus: 27,
  Equal: 24,
  BracketLeft: 33,
  BracketRight: 30,
  Backslash: 42,
  Semicolon: 41,
  Quote: 39,
  Backquote: 50,
  Comma: 43,
  Period: 47,
  Slash: 44,

  // Special keys
  Enter: 36,
  Tab: 48,
  Space: 49,
  Backspace: 51,
  Escape: 53,
  Delete: 117,
  Home: 115,
  End: 119,
  PageUp: 116,
  PageDown: 121,

  // Arrow keys
  ArrowUp: 126,
  ArrowDown: 125,
  ArrowLeft: 123,
  ArrowRight: 124,

  // Modifier keys
  ShiftLeft: 56,
  ShiftRight: 60,
  ControlLeft: 59,
  ControlRight: 62,
  AltLeft: 58,
  AltRight: 61,
  MetaLeft: 55,
  MetaRight: 54,
  CapsLock: 57,

  // Function keys
  F1: 122,
  F2: 120,
  F3: 99,
  F4: 118,
  F5: 96,
  F6: 97,
  F7: 98,
  F8: 100,
  F9: 101,
  F10: 109,
  F11: 103,
  F12: 111,
};

/// Build the HID modifier flags bitmask from a KeyboardEvent.
export function modifierFlagsFromEvent(e: KeyboardEvent): number {
  let flags = 0;
  if (e.getModifierState("CapsLock")) {
    flags |= 0x10000;
  }
  if (e.shiftKey) {
    flags |= 0x20000;
  }
  if (e.ctrlKey) {
    flags |= 0x40000;
  }
  if (e.altKey) {
    flags |= 0x80000;
  }
  if (e.metaKey) {
    flags |= 0x100000;
  }

  return flags;
}
