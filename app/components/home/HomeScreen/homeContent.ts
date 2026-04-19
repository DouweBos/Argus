import type { Shortcut } from "@argus/peacock";
import {
  shortcutKeys,
  shortcutLabel,
  type ShortcutId,
} from "../../../lib/shortcuts";

const HOME_SHORTCUT_IDS: ShortcutId[] = [
  "open-repo",
  "new-workspace",
  "command-palette",
  "new-agent",
  "settings",
];

export const HOME_SHORTCUTS: Shortcut[] = HOME_SHORTCUT_IDS.map((id) => ({
  keys: shortcutKeys(id),
  label: shortcutLabel(id),
}));

export const HOME_TIPS = [
  {
    title: "Spin up parallel ideas",
    body: "Every workspace is an isolated git worktree. Run five attempts side-by-side — none step on each other.",
  },
  {
    title: "Approve only what you need",
    body: "The permission broker lets you allow a single tool call, or always-allow a pattern. Stop agents from running away.",
  },
  {
    title: "Drive simulators from the agent",
    body: "The conductor CLI is pre-wired. Agents tap, scroll, and type in your simulators for real UI testing.",
  },
];
