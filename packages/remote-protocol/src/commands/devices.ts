import type { CommandSpec } from "./spec";

export const DEVICE_COMMANDS = {} as const satisfies Record<
  string,
  CommandSpec
>;
