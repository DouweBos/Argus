/**
 * Memory operations for callers outside a run (IPC, the remote gateway),
 * which name the automation themselves and so have to name a real one.
 */

import type { AutomationMemory, SaveMemoryInput } from "../models";
import { getAutomation } from "../manager";
import {
  deleteMemory,
  listMemories,
  readMemoryIndex,
  saveMemory,
} from "./store";

function assertAutomation(automationId: string): void {
  if (!getAutomation(automationId)) {
    throw `Automation not found: ${automationId}`;
  }
}

export function listAutomationMemories(automationId: string): {
  index: string | null;
  memories: AutomationMemory[];
} {
  assertAutomation(automationId);

  return {
    index: readMemoryIndex(automationId),
    memories: listMemories(automationId),
  };
}

export function saveAutomationMemory(
  automationId: string,
  input: SaveMemoryInput,
): AutomationMemory {
  assertAutomation(automationId);

  return saveMemory(automationId, input);
}

export function deleteAutomationMemory(
  automationId: string,
  name: string,
): void {
  assertAutomation(automationId);
  deleteMemory(automationId, name);
}
