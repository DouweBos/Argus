/**
 * The command catalog: every host command, merged from its domain file.
 */

import type { CommandSpec } from "./spec";
import type { z } from "zod";
import { AGENT_COMMANDS } from "./agents";
import { AUTOMATION_COMMANDS } from "./automations";
import { BROWSER_COMMANDS } from "./browser";
import { DEVICE_COMMANDS } from "./devices";
import { FILE_COMMANDS } from "./files";
import { GIT_COMMANDS } from "./git";
import { GIT_RUNNER_COMMANDS } from "./gitRunner";
import { GITHUB_COMMANDS } from "./github";
import { LLM_COMMANDS } from "./llm";
import { MCP_COMMANDS } from "./mcp";
import { ONBOARDING_COMMANDS } from "./onboarding";
import { REMOTE_COMMANDS } from "./remote";
import { SESSION_COMMANDS } from "./sessions";
import { SETTINGS_COMMANDS } from "./settings";
import { SHELL_COMMANDS } from "./shell";
import { TERMINAL_COMMANDS } from "./terminals";

export * from "./spec";
export { SHELL_COMMANDS } from "./shell";
export * from "../models/files";
export * from "../models/shell";
export * from "../models/git";
export * from "../models/sessions";
export * from "../models/agents";
export * from "../models/conversation";
export * from "../models/terminals";
export * from "../models/automations";
export * from "../models/onboarding";
export * from "../models/settings";
export * from "../models/llm";
export * from "../models/devices";
export * from "../models/browser";
export * from "../models/remote";
export * from "../models/mcp";
export * from "../models/github";
export * from "../models/gitRunner";

/** Each domain's entries, kept apart so a test can prove no name repeats. */
export const COMMAND_DOMAINS: Record<string, Record<string, CommandSpec>> = {
  files: FILE_COMMANDS,
  git: GIT_COMMANDS,
  sessions: SESSION_COMMANDS,
  agents: AGENT_COMMANDS,
  terminals: TERMINAL_COMMANDS,
  automations: AUTOMATION_COMMANDS,
  onboarding: ONBOARDING_COMMANDS,
  settings: SETTINGS_COMMANDS,
  llm: LLM_COMMANDS,
  devices: DEVICE_COMMANDS,
  browser: BROWSER_COMMANDS,
  remote: REMOTE_COMMANDS,
  mcp: MCP_COMMANDS,
  github: GITHUB_COMMANDS,
  gitRunner: GIT_RUNNER_COMMANDS,
  shell: SHELL_COMMANDS,
};

export const COMMANDS = {
  ...FILE_COMMANDS,
  ...GIT_COMMANDS,
  ...SESSION_COMMANDS,
  ...AGENT_COMMANDS,
  ...TERMINAL_COMMANDS,
  ...AUTOMATION_COMMANDS,
  ...ONBOARDING_COMMANDS,
  ...SETTINGS_COMMANDS,
  ...LLM_COMMANDS,
  ...DEVICE_COMMANDS,
  ...BROWSER_COMMANDS,
  ...REMOTE_COMMANDS,
  ...MCP_COMMANDS,
  ...GITHUB_COMMANDS,
  ...GIT_RUNNER_COMMANDS,
  ...SHELL_COMMANDS,
} as const;

export type Commands = typeof COMMANDS;
export type CommandName = string & keyof Commands;

type SpecOf<N extends CommandName> = Commands[N] extends CommandSpec
  ? Commands[N]
  : never;

/** What a handler receives — defaults applied. */
export type ParamsOf<N extends CommandName> = z.output<SpecOf<N>["params"]>;
/** What a caller sends. */
export type ParamsIn<N extends CommandName> = z.input<SpecOf<N>["params"]>;
export type ResultOf<N extends CommandName> = z.output<SpecOf<N>["result"]>;

export function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(COMMANDS, name);
}

/** The catalog entry for a command, or null when it has none yet. */
export function commandSpec(name: string): CommandSpec | null {
  return isCommandName(name) ? (COMMANDS[name] as CommandSpec) : null;
}
