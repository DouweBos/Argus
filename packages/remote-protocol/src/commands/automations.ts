import type { CommandSpec } from "./spec";

export const AUTOMATION_COMMANDS = {} as const satisfies Record<
  string,
  CommandSpec
>;
