/**
 * The Usage screen's keys: C / T / L pick Cost / Tokens / Limits, Cmd+Shift+1–4
 * (Ctrl+Shift off macOS) pick the range, Escape goes back. Shared so the web
 * client and the native apps bind the same set.
 */

import type { UsageTab } from "../routes/route";
import type { UsageRange } from "@argus/remote-protocol";

export interface ShortcutKey {
  key: string;
  /** `KeyboardEvent.code`: Shift turns "1" into "!", the code stays "Digit1". */
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export type UsageShortcut =
  | { kind: "back" }
  | { kind: "range"; range: UsageRange }
  | { kind: "tab"; tab: UsageTab };

const TAB_KEYS: Record<string, UsageTab> = {
  c: "cost",
  t: "tokens",
  l: "limits",
};

const RANGE_CODES: Record<string, UsageRange> = {
  Digit1: "24h",
  Digit2: "7d",
  Digit3: "30d",
  Digit4: "90d",
};

export function usageShortcut(
  e: ShortcutKey,
  { mac, typing, tab }: { mac: boolean; typing: boolean; tab: UsageTab },
): UsageShortcut | null {
  if (typing) {
    return null;
  }
  if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    return { kind: "back" };
  }
  const command = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (command && e.shiftKey && !e.altKey) {
    const range = RANGE_CODES[e.code];

    return range && tab !== "limits" ? { kind: "range", range } : null;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
    return null;
  }
  const next = TAB_KEYS[e.key.toLowerCase()];

  return next ? { kind: "tab", tab: next } : null;
}
