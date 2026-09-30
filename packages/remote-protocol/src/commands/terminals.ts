import type { CommandSpec } from "./spec";

export const TERMINAL_COMMANDS = {} as const satisfies Record<
  string,
  CommandSpec
>;
