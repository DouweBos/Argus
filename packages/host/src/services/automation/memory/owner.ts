import type { Automation, MemoryOwner } from "../models";

/** The memory an automation's runs read and write. */
export function memoryOwnerForAutomation(
  automation: Pick<Automation, "id">,
): MemoryOwner {
  return { kind: "automation", id: automation.id };
}
