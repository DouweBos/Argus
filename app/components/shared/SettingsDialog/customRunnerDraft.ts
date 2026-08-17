/**
 * Draft shape for the custom-runner form. The env map is edited as an
 * ordered list so a key stays editable while it's being typed.
 */

import type { CustomRunnerConfig } from "../../../lib/types";

export interface EnvRow {
  key: string;
  value: string;
}

export interface RunnerDraft extends Omit<CustomRunnerConfig, "env"> {
  envRows: EnvRow[];
}

export function toDraft(config: CustomRunnerConfig): RunnerDraft {
  const { env, ...rest } = config;

  return {
    ...rest,
    envRows: Object.entries(env).map(([key, value]) => ({ key, value })),
  };
}

export function fromDraft(draft: RunnerDraft): CustomRunnerConfig {
  const { envRows, ...rest } = draft;
  const env: Record<string, string> = {};
  for (const row of envRows) {
    const key = row.key.trim();
    if (key) {
      env[key] = row.value;
    }
  }

  return { ...rest, env };
}
