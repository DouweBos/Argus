/**
 * Translate browser `KeyboardEvent.code` values to the platform-native key
 * codes the device bridges expect: macOS virtual keycodes for iOS simulators,
 * Android `KEYCODE_*` for emulators. Keyed by physical `code` (layout-stable).
 */

export interface NativeKey {
  keyCode: number;
  modifiers: number;
}

/** NSEventModifierFlagShift — carries capitalization / shifted symbols to iOS. */
const IOS_SHIFT = 0x20000;
/** AMETA_SHIFT_ON. */
const ANDROID_SHIFT = 0x1;

// macOS virtual keycodes (kVK_*).
const IOS_CODES: Record<string, number> = {
  KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyH: 4, KeyG: 5, KeyZ: 6, KeyX: 7,
  KeyC: 8, KeyV: 9, KeyB: 11, KeyQ: 12, KeyW: 13, KeyE: 14, KeyR: 15, KeyY: 16,
  KeyT: 17, KeyO: 31, KeyU: 32, KeyI: 34, KeyP: 35, KeyL: 37, KeyJ: 38,
  KeyK: 40, KeyN: 45, KeyM: 46,
  Digit1: 18, Digit2: 19, Digit3: 20, Digit4: 21, Digit5: 23, Digit6: 22,
  Digit7: 26, Digit8: 28, Digit9: 25, Digit0: 29,
  Enter: 36, Tab: 48, Space: 49, Backspace: 51, Escape: 53, Delete: 117,
  ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126,
  Minus: 27, Equal: 24, BracketLeft: 33, BracketRight: 30, Backslash: 42,
  Semicolon: 41, Quote: 39, Comma: 43, Period: 47, Slash: 44, Backquote: 50,
};

// Android KEYCODE_* values.
const ANDROID_CODES: Record<string, number> = {
  KeyA: 29, KeyB: 30, KeyC: 31, KeyD: 32, KeyE: 33, KeyF: 34, KeyG: 35,
  KeyH: 36, KeyI: 37, KeyJ: 38, KeyK: 39, KeyL: 40, KeyM: 41, KeyN: 42,
  KeyO: 43, KeyP: 44, KeyQ: 45, KeyR: 46, KeyS: 47, KeyT: 48, KeyU: 49,
  KeyV: 50, KeyW: 51, KeyX: 52, KeyY: 53, KeyZ: 54,
  Digit0: 7, Digit1: 8, Digit2: 9, Digit3: 10, Digit4: 11, Digit5: 12,
  Digit6: 13, Digit7: 14, Digit8: 15, Digit9: 16,
  Space: 62, Enter: 66, Backspace: 67, Tab: 61, Escape: 111, Delete: 112,
  ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22,
  Comma: 55, Period: 56, Minus: 69, Equal: 70, BracketLeft: 71,
  BracketRight: 72, Backslash: 73, Semicolon: 74, Quote: 75, Slash: 76,
  Backquote: 68,
};

export function toNativeKey(
  platform: "ios" | "android",
  code: string,
  shift: boolean,
): NativeKey | null {
  if (platform === "ios") {
    const keyCode = IOS_CODES[code];
    if (keyCode === undefined) {
      return null;
    }
    return { keyCode, modifiers: shift ? IOS_SHIFT : 0 };
  }
  const keyCode = ANDROID_CODES[code];
  if (keyCode === undefined) {
    return null;
  }
  return { keyCode, modifiers: shift ? ANDROID_SHIFT : 0 };
}
