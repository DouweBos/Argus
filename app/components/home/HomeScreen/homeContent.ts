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
