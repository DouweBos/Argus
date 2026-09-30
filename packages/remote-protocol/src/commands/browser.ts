import type { CommandSpec } from "./spec";

export const BROWSER_COMMANDS = {} as const satisfies Record<
  string,
  CommandSpec
>;
