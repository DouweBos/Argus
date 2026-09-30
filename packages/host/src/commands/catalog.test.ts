/**
 * The catalog is the contract every client is typed from, so it has to be
 * internally sound: one entry per name, and the host registers against it.
 */

import {
  COMMAND_DOMAINS,
  COMMANDS,
  SHELL_COMMANDS,
} from "@argus/remote-protocol";
import { beforeEach, describe, expect, it } from "vitest";
import {
  listCommands,
  resetCommandRegistry,
} from "../services/command/registry";
import { registerHostCommands } from "./index";

describe("the command catalog", () => {
  it("never defines a name in two domains", () => {
    const names = Object.values(COMMAND_DOMAINS).flatMap((d) => Object.keys(d));
    expect(names).toHaveLength(new Set(names).size);
    expect(Object.keys(COMMANDS).sort()).toEqual([...names].sort());
  });
});

describe("registerHostCommands", () => {
  beforeEach(() => {
    resetCommandRegistry();
  });

  it("registers only catalog commands, each at its catalog tier", () => {
    registerHostCommands();
    const catalog: Record<string, { tier: string }> = COMMANDS;
    const drift = listCommands()
      .filter((c) => catalog[c.name]?.tier !== c.tier)
      .map((c) => c.name);
    expect(drift).toEqual([]);
  });

  it("leaves the shell's commands to the desktop", () => {
    registerHostCommands();
    const shell = listCommands()
      .map((c) => c.name)
      .filter((name) => Object.hasOwn(SHELL_COMMANDS, name));
    expect(shell).toEqual([]);
  });
});
