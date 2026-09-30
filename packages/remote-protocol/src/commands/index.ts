/**
 * The command catalog: every host command, merged from its domain file.
 */

import type { CommandSpec } from "./spec";
import type { z } from "zod";
import { FILE_COMMANDS } from "./files";

export * from "./spec";
export * from "../models/files";

/** Each domain's entries, kept apart so a test can prove no name repeats. */
export const COMMAND_DOMAINS: Record<string, Record<string, CommandSpec>> = {
  files: FILE_COMMANDS,
};

export const COMMANDS = {
  ...FILE_COMMANDS,
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
