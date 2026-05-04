/**
 * Renderer-side helpers for the canonical permission modes that the
 * runner abstraction exposes (`auto`, `ask`, `plan`, `review`, `trusted`).
 *
 * The Claude Code runner accepts both canonical names and its native
 * vocabulary (`auto`, `default`, `acceptEdits`, `plan`, `bypassPermissions`),
 * so the UI sticks to canonical names and lets the runner translate. The
 * agent's `permission_mode` field on the front-end may still carry
 * runner-native values; {@link toCanonicalPermissionMode} normalises either
 * form down to the canonical key the picker compares against.
 */

export type CanonicalPermissionMode =
  "ask" | "auto" | "plan" | "review" | "trusted";

export interface PermissionModeOption {
  description: string;
  displayName: string;
  value: CanonicalPermissionMode;
}

export const PERMISSION_MODE_OPTIONS: PermissionModeOption[] = [
  {
    value: "auto",
    displayName: "Auto",
    description:
      "Smart classifier auto-approves safe actions; risky ones still ask.",
  },
  {
    value: "ask",
    displayName: "Ask",
    description: "Ask before edits, commands, and other writes.",
  },
  {
    value: "plan",
    displayName: "Plan",
    description: "Read-only — agent must present a plan before any writes.",
  },
  {
    value: "review",
    displayName: "Accept edits",
    description: "Auto-approve file edits; still ask for shell + network.",
  },
  {
    value: "trusted",
    displayName: "Trusted",
    description: "Auto-approve every tool call. Use with caution.",
  },
];

const CANONICAL_SET = new Set<CanonicalPermissionMode>([
  "auto",
  "ask",
  "plan",
  "review",
  "trusted",
]);

/**
 * Normalise any permission-mode string (canonical, Claude-native, or
 * undefined) to the canonical key used by the picker. Anything we don't
 * recognise — including `undefined` — falls back to `"auto"`.
 */
export function toCanonicalPermissionMode(
  mode: string | null | undefined,
): CanonicalPermissionMode {
  if (!mode) {
    return "auto";
  }
  if (CANONICAL_SET.has(mode as CanonicalPermissionMode)) {
    return mode as CanonicalPermissionMode;
  }
  switch (mode) {
    case "default":
      return "ask";
    case "acceptEdits":
      return "review";
    case "bypassPermissions":
      return "trusted";
    default:
      return "auto";
  }
}

/**
 * Cycle to the next canonical mode in display order. Used by the
 * `Shift+Tab` keybinding (Claude Code's own convention) to flip through
 * modes without leaving the keyboard.
 *
 * `trusted` is excluded from the cycle because Claude CLI rejects switching
 * to `bypassPermissions` on a running session — it can only be set at agent
 * startup. The picker still exposes it for launch-time selection.
 */
const CYCLE_ORDER: CanonicalPermissionMode[] = [
  "auto",
  "ask",
  "plan",
  "review",
];

export function nextPermissionMode(
  mode: CanonicalPermissionMode,
): CanonicalPermissionMode {
  const idx = CYCLE_ORDER.indexOf(mode);
  if (idx === -1) {
    return "auto";
  }

  return CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length];
}

export function permissionModeDisplayName(
  mode: CanonicalPermissionMode,
): string {
  return (
    PERMISSION_MODE_OPTIONS.find((o) => o.value === mode)?.displayName ?? "Auto"
  );
}
