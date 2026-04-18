import type { Shortcut } from "@argus/peacock";

export const HOME_SHORTCUTS: Shortcut[] = [
  { keys: ["⌘", "O"], label: "Open repo" },
  { keys: ["⌘", "N"], label: "New workspace" },
  { keys: ["⌘", "K"], label: "Command palette" },
  { keys: ["⌘", "⇧", "A"], label: "New agent" },
  { keys: ["⌘", ","], label: "Settings" },
];

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
