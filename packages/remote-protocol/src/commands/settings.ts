import type { CommandSpec } from "./spec";

export const SETTINGS_COMMANDS = {} as const satisfies Record<
  string,
  CommandSpec
>;
