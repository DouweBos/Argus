/**
 * Maps KeyboardEvent.code to Android AKEYCODE_* values.
 *
 * Reference: https://developer.android.com/reference/android/view/KeyEvent
 *
 * This is the Android counterpart of keycodeMap.ts (which maps to macOS
 * virtual keycodes for the iOS simulator).
 */

export const ANDROID_KEYCODE_MAP: Record<string, number> = {
  // Letters
  KeyA: 29,
  KeyB: 30,
  KeyC: 31,
  KeyD: 32,
  KeyE: 33,
  KeyF: 34,
  KeyG: 35,
  KeyH: 36,
  KeyI: 37,
  KeyJ: 38,
  KeyK: 39,
  KeyL: 40,
  KeyM: 41,
  KeyN: 42,
  KeyO: 43,
  KeyP: 44,
  KeyQ: 45,
  KeyR: 46,
  KeyS: 47,
  KeyT: 48,
  KeyU: 49,
  KeyV: 50,
  KeyW: 51,
  KeyX: 52,
  KeyY: 53,
  KeyZ: 54,

  // Digits
  Digit0: 7,
  Digit1: 8,
  Digit2: 9,
  Digit3: 10,
  Digit4: 11,
  Digit5: 12,
  Digit6: 13,
  Digit7: 14,
  Digit8: 15,
  Digit9: 16,

  // Function keys
  F1: 131,
  F2: 132,
  F3: 133,
  F4: 134,
  F5: 135,
  F6: 136,
  F7: 137,
  F8: 138,
  F9: 139,
  F10: 140,
  F11: 141,
  F12: 142,

  // Navigation
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,

  // Editing
  Backspace: 67,
  Delete: 112,
  Enter: 66,
  NumpadEnter: 66,
  Tab: 61,
  Space: 62,
  Escape: 111,

  // Symbols
  Comma: 55,
  Period: 56,
  Semicolon: 74,
  Quote: 75,
  BracketLeft: 71,
  BracketRight: 72,
  Backquote: 68,
  Minus: 69,
  Equal: 70,
  Slash: 76,
  Backslash: 73,

  // Modifiers (sent as meta state, but also have keycodes)
  ShiftLeft: 59,
  ShiftRight: 60,
  ControlLeft: 113,
  ControlRight: 114,
  AltLeft: 57,
  AltRight: 58,
  MetaLeft: 117,
  MetaRight: 118,
  CapsLock: 115,

  // Media / special
  Home: 3,
  End: 123,
  PageUp: 92,
  PageDown: 93,
  Insert: 124,
};

/**
 * Build Android meta state flags from a KeyboardEvent.
 *
 * Android meta state is a bitmask:
 *   META_SHIFT_ON    = 0x1
 *   META_ALT_ON      = 0x2
 *   META_CTRL_ON     = 0x1000
 *   META_META_ON     = 0x10000
 */
export function androidMetaStateFromEvent(e: KeyboardEvent): number {
  let meta = 0;
  if (e.shiftKey) {
    meta |= 0x1;
  }
  if (e.altKey) {
    meta |= 0x2;
  }
  if (e.ctrlKey) {
    meta |= 0x1000;
  }
  if (e.metaKey) {
    meta |= 0x10000;
  }

  return meta;
}
