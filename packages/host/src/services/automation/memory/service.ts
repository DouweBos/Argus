/**
 * Memory operations for callers outside a run (IPC, the remote gateway),
 * which name the automation themselves and so have to name a real one.
 */

import type { AutomationMemory, MemoryOwner, SaveMemoryInput } from "../models";
import { getAutomation } from "../manager";
import { memoryOwnerForAutomation } from "./owner";
import {
  deleteMemory,
  listMemories,
  readMemoryIndex,
  saveMemory,
} from "./store";

function ownerOf(automationId: string): MemoryOwner {
  const automation = getAutomation(automationId);
  if (!automation) {
    throw `Automation not found: ${automationId}`;
  }

  return memoryOwnerForAutomation(automation);
}

export function listAutomationMemories(automationId: string): {
  index: string | null;
  memories: AutomationMemory[];
} {
  const owner = ownerOf(automationId);

  return { index: readMemoryIndex(owner), memories: listMemories(owner) };
}

export function saveAutomationMemory(
  automationId: string,
  input: SaveMemoryInput,
): AutomationMemory {
  return saveMemory(ownerOf(automationId), input);
}

export function deleteAutomationMemory(
  automationId: string,
  name: string,
): void {
  deleteMemory(ownerOf(automationId), name);
}
