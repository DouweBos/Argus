/**
 * Saving the Project Settings dialog over the raw `.argus.json`: only the keys
 * the dialog edits change, everything else in the file survives.
 */

type RawConfig = Record<string, unknown>;

/** Top-level keys the dialog edits; `workspace_port_env` is the legacy `workspace_env`. */
export const DIALOG_OWNED_KEYS: ReadonlySet<string> = new Set([
  "setup",
  "terminals",
  "run",
  "workspace_env",
  "workspace_port_env",
  "related_projects",
  "browser_url",
  "browser_presets",
  "simulator_deeplinks",
  "auto_continue_on_limit",
  "protected_branches",
  "default_base_branch",
  "single_runtime",
  "release_note_patterns",
  "llm",
  "tools",
  "automations",
]);

/** Objects the dialog edits only some keys of; their other keys survive. */
const NESTED_OWNED_KEYS: Readonly<Record<string, readonly string[]>> = {
  setup: ["copy", "symlink", "commands"],
  llm: ["runner", "model"],
  tools: ["disabled"],
  automations: ["autonomy_ceiling", "path_denylist", "disabled"],
};

/** Settings Argus no longer reads; saving drops them. */
export const RETIRED_KEYS: ReadonlySet<string> = new Set([
  "platforms",
  "agent_prompt",
  "mcp_servers",
  "pull_request_template",
  "min_argus_version",
  "save_chat_history",
]);

function isObject(value: unknown): value is RawConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeNested(key: string, raw: unknown, edited: unknown): unknown {
  const owned = NESTED_OWNED_KEYS[key];
  if (!owned || !isObject(raw)) {
    return edited;
  }
  const kept = Object.fromEntries(
    Object.entries(raw).filter(([k]) => !owned.includes(k)),
  );
  const merged = { ...kept, ...(isObject(edited) ? edited : {}) };
  if (edited === undefined && Object.keys(merged).length === 0) {
    return undefined;
  }

  return merged;
}

/**
 * `raw` with every dialog-owned key replaced by `edits` (or removed when the
 * dialog leaves it empty) and retired keys dropped. Key order is preserved.
 */
export function applyDialogEdits(
  raw: RawConfig | null,
  edits: RawConfig,
): RawConfig {
  const out: RawConfig = {};
  const source = raw ?? {};
  for (const [key, value] of Object.entries(source)) {
    if (RETIRED_KEYS.has(key)) {
      continue;
    }
    if (!DIALOG_OWNED_KEYS.has(key)) {
      out[key] = value;
      continue;
    }
    const next = mergeNested(key, value, edits[key]);
    if (next !== undefined) {
      out[key] = next;
    }
  }
  for (const [key, value] of Object.entries(edits)) {
    if (!(key in out) && value !== undefined) {
      out[key] = mergeNested(key, source[key], value);
    }
  }

  return out;
}
