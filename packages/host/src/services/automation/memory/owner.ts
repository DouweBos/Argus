import type { Automation, MemoryOwner } from "../models";

/** The memory an automation's runs read and write: its teammate's, if it has one. */
export function memoryOwnerForAutomation(
  automation: Partial<Pick<Automation, "teammate_id">> & Pick<Automation, "id">,
): MemoryOwner {
  return automation.teammate_id
    ? { kind: "teammate", id: automation.teammate_id }
    : { kind: "automation", id: automation.id };
}
