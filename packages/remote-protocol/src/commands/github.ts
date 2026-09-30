import type { CommandSpec } from "./spec";

export const GITHUB_COMMANDS = {} as const satisfies Record<
  string,
  CommandSpec
>;
