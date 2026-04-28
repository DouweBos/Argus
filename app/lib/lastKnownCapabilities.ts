import type { SlashCommand } from "./types";
import type { ModelOption } from "../components/agent/ModelPicker";
import { getConversationState } from "../stores/conversationStore";

const STORAGE_KEY = "argus:last-capabilities";

interface PersistedCapabilities {
  models: ModelOption[];
  slashCommands: SlashCommand[];
}

/**
 * Persist the most recent capabilities so the model picker + slash-command
 * autocomplete in dialogs stay populated across app launches. Without this
 * the very first dialog after launch always shows nothing.
 *
 * Called from `setCapabilities` (conversationStore) every time an agent
 * reports its initialize handshake.
 */
export function persistLastKnownCapabilities(payload: {
  models?: ModelOption[];
  slashCommands?: SlashCommand[];
}) {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    const prev = readPersisted();
    const next: PersistedCapabilities = {
      models: payload.models?.length ? payload.models : prev.models,
      slashCommands: payload.slashCommands?.length
        ? payload.slashCommands
        : prev.slashCommands,
    };
    if (next.models.length === 0 && next.slashCommands.length === 0) {
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable / quota exceeded — non-fatal.
  }
}

function readPersisted(): PersistedCapabilities {
  if (typeof localStorage === "undefined") {
    return { models: [], slashCommands: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { models: [], slashCommands: [] };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedCapabilities>;

    return {
      models: Array.isArray(parsed.models) ? parsed.models : [],
      slashCommands: Array.isArray(parsed.slashCommands)
        ? parsed.slashCommands
        : [],
    };
  } catch {
    return { models: [], slashCommands: [] };
  }
}

/**
 * Best-effort lookup of model + slash-command lists *before* a fresh agent
 * has reported its own capabilities.
 *
 * Resolution order:
 *  1. In-memory conversations — most current; reflects any agent the user
 *     has spawned this session.
 *  2. `localStorage` cache — written by every successful initialize, so
 *     after the user has used Argus once these are immediately available
 *     across launches.
 *
 * Returns empty arrays on a fresh install where no agent has ever
 * reported its capabilities. Callers should hide their model picker /
 * slash-command UI in that case rather than guess.
 */
export function getLastKnownCapabilities(): {
  models: ModelOption[];
  slashCommands: SlashCommand[];
} {
  const conversations = getConversationState().conversations;
  let models: ModelOption[] = [];
  let slashCommands: SlashCommand[] = [];
  for (const conv of Object.values(conversations)) {
    if (models.length === 0 && conv.capabilities?.models?.length) {
      models = conv.capabilities.models.map((m) => ({
        value: m.value,
        displayName: m.displayName,
        description: m.description,
      }));
    }
    if (slashCommands.length === 0 && conv.slashCommands?.length) {
      slashCommands = conv.slashCommands;
    }
    if (models.length > 0 && slashCommands.length > 0) {
      break;
    }
  }

  if (models.length === 0 || slashCommands.length === 0) {
    const persisted = readPersisted();
    if (models.length === 0) {
      models = persisted.models;
    }
    if (slashCommands.length === 0) {
      slashCommands = persisted.slashCommands;
    }
  }

  return { models, slashCommands };
}
