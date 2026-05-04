/**
 * Translate Argus-canonical permission modes to Claude Code's native names.
 *
 * Phase 1 keeps a permissive shim: callers may still pass the Claude-native
 * names (`default`, `acceptEdits`, `plan`, `bypassPermissions`) and they
 * pass through unchanged. Canonical names map per the Resolved Decisions
 * table. Anything else is forwarded as-is so the CLI surfaces its own error.
 */

import type { CanonicalPermissionMode } from "../types";

const CANONICAL_TO_CLAUDE: Record<CanonicalPermissionMode, string> = {
  auto: "auto",
  ask: "default",
  review: "acceptEdits",
  plan: "plan",
  trusted: "bypassPermissions",
};

const CLAUDE_NATIVE = new Set([
  "auto",
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "dontAsk",
]);

export function toClaudePermissionMode(
  mode: CanonicalPermissionMode | string | null | undefined,
): string | null {
  if (!mode) {
    return null;
  }
  if (mode in CANONICAL_TO_CLAUDE) {
    return CANONICAL_TO_CLAUDE[mode as CanonicalPermissionMode];
  }
  if (CLAUDE_NATIVE.has(mode)) {
    return mode;
  }

  // Unknown — pass through so the CLI surfaces its own error message.
  return mode;
}
