import type { CommandSpec } from "./spec";

/** Window-, dialog- and updater-bound commands the desktop shell registers. */
export const SHELL_COMMANDS = {} as const satisfies Record<string, CommandSpec>;
