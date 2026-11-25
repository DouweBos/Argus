import {
  cancelClone,
  cloneDefaults,
  listClones,
  previewClone,
  startClone,
} from "../services/clone/jobs";
import { defineTypedCommand } from "../services/command/registry";

export function registerCloneCommands(): void {
  defineTypedCommand("clone_defaults", () => cloneDefaults());
  defineTypedCommand("clone_preview", (p) => previewClone(p.input));
  defineTypedCommand("clone_start", (p) => startClone(p.input));
  defineTypedCommand("clone_cancel", (p) => ({ accepted: cancelClone(p.id) }));
  defineTypedCommand("clones_list", () => listClones());
}
