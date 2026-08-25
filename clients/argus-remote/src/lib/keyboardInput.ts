/**
 * Map typed characters from the on-screen keyboard to the physical `code`
 * values `keymap.ts` understands, so phone typing forwards to the device the
 * same way a hardware keyboard does on the web client.
 */

import { toNativeKey, type NativeKey } from "./keymap";
import type { RemotePlatform } from "./protocol";

const SYMBOL_CODES: Record<string, { code: string; shift: boolean }> = {
  " ": { code: "Space", shift: false },
  "\n": { code: "Enter", shift: false },
  "-": { code: "Minus", shift: false },
  _: { code: "Minus", shift: true },
  "=": { code: "Equal", shift: false },
  "+": { code: "Equal", shift: true },
  "[": { code: "BracketLeft", shift: false },
  "{": { code: "BracketLeft", shift: true },
  "]": { code: "BracketRight", shift: false },
  "}": { code: "BracketRight", shift: true },
  "\\": { code: "Backslash", shift: false },
  "|": { code: "Backslash", shift: true },
  ";": { code: "Semicolon", shift: false },
  ":": { code: "Semicolon", shift: true },
  "'": { code: "Quote", shift: false },
  '"': { code: "Quote", shift: true },
  ",": { code: "Comma", shift: false },
  "<": { code: "Comma", shift: true },
  ".": { code: "Period", shift: false },
  ">": { code: "Period", shift: true },
  "/": { code: "Slash", shift: false },
  "?": { code: "Slash", shift: true },
  "`": { code: "Backquote", shift: false },
  "~": { code: "Backquote", shift: true },
};

const SHIFTED_DIGITS: Record<string, string> = {
  "!": "Digit1",
  "@": "Digit2",
  "#": "Digit3",
  $: "Digit4",
  "%": "Digit5",
  "^": "Digit6",
  "&": "Digit7",
  "*": "Digit8",
  "(": "Digit9",
  ")": "Digit0",
};

/** Translate one character (or "Backspace"/"Enter") to a native key press. */
export function characterToNativeKey(
  platform: RemotePlatform,
  char: string,
): NativeKey | null {
  if (char === "Backspace") {
    return toNativeKey(platform, "Backspace", false);
  }
  if (char === "Enter" || char === "\n") {
    return toNativeKey(platform, "Enter", false);
  }
  if (/^[a-z]$/.test(char)) {
    return toNativeKey(platform, `Key${char.toUpperCase()}`, false);
  }
  if (/^[A-Z]$/.test(char)) {
    return toNativeKey(platform, `Key${char}`, true);
  }
  if (/^[0-9]$/.test(char)) {
    return toNativeKey(platform, `Digit${char}`, false);
  }
  const shiftedDigit = SHIFTED_DIGITS[char];
  if (shiftedDigit) {
    return toNativeKey(platform, shiftedDigit, true);
  }
  const symbol = SYMBOL_CODES[char];

  return symbol ? toNativeKey(platform, symbol.code, symbol.shift) : null;
}
