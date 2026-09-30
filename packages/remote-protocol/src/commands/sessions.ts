import type { CommandSpec } from "./spec";

export const SESSION_COMMANDS = {} as const satisfies Record<
  string,
  CommandSpec
>;
