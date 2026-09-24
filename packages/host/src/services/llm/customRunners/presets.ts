/**
 * Starting points for custom runners.
 *
 * A preset is just a pre-filled {@link CustomRunner} draft — the user picks
 * one, pastes their API key, and saves. Nothing is auto-registered.
 */

import type { CustomRunner } from "./store";

export interface CustomRunnerPreset {
  /** Stable preset key, e.g. `apex`. */
  key: string;
  /** Label shown in the "Add runner" menu. */
  label: string;
  /** One-liner describing the provider. */
  description: string;
  /** Env var the user must fill in with their key/token. */
  secretEnvKey: string;
  /** Draft config, with the secret env var left blank. */
  draft: Omit<CustomRunner, "id">;
}

export const CUSTOM_RUNNER_PRESETS: CustomRunnerPreset[] = [
  {
    key: "apex",
    label: "Apex (callstack.ai)",
    description:
      "Runs Claude Code against callstack.ai's Anthropic-compatible endpoint.",
    secretEnvKey: "ANTHROPIC_AUTH_TOKEN",
    draft: {
      displayName: "Apex",
      baseRunnerId: "claude-code",
      env: {
        ANTHROPIC_BASE_URL: "https://api.callstack.ai",
        ANTHROPIC_AUTH_TOKEN: "",
        // Attribution headers are rejected by the gateway.
        CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
        // The gateway doesn't advertise a window, so auto-compact assumes
        // 200k. Fill this in to hold the real one; blank leaves it unset.
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: "",
      },
      models: [
        {
          id: "callstack/Apex",
          displayName: "Apex",
          description: "callstack.ai",
        },
      ],
      defaultModel: "callstack/Apex",
    },
  },
  {
    key: "blank",
    label: "Blank",
    description: "Start from an empty config.",
    secretEnvKey: "ANTHROPIC_AUTH_TOKEN",
    draft: {
      displayName: "",
      baseRunnerId: "claude-code",
      env: { ANTHROPIC_BASE_URL: "", ANTHROPIC_AUTH_TOKEN: "" },
      models: [],
      defaultModel: null,
    },
  },
];
