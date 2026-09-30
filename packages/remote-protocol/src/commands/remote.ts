import type { CommandSpec } from "./spec";

export const REMOTE_COMMANDS = {} as const satisfies Record<
  string,
  CommandSpec
>;
