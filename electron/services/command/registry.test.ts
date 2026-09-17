/**
 * The command registry: one table behind local IPC and the wire.
 *
 * Two things must hold. Structurally, every `defineCommand` also registers an
 * `ipcMain.handle` with the same name, so the renderer and the gateway can
 * never see different command sets. Statically, every registration in
 * `ipc.ts` carries a tier, and the host-tier ones are exactly the names the
 * shared `HOST_ONLY_COMMANDS` set promises never cross the wire.
 */

import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOST_ONLY_COMMANDS } from "@argus/remote-protocol";

const handleMock = vi.fn();
vi.mock("electron", () => ({ ipcMain: { handle: handleMock } }));

const {
  commandNamesForTier,
  defineCommand,
  getCommand,
  getCommandTier,
  hasCommand,
  invokeCommand,
  listCommands,
  resetCommandRegistry,
} = await import("./registry");

describe("defineCommand", () => {
  beforeEach(() => {
    resetCommandRegistry();
    handleMock.mockClear();
  });

  it("records the definition and registers one ipcMain handler", () => {
    defineCommand("thing_list", { tier: "admin", handler: () => ["a"] });

    expect(getCommand("thing_list")).toMatchObject({
      name: "thing_list",
      tier: "admin",
    });
    expect(hasCommand("thing_list")).toBe(true);
    expect(getCommandTier("thing_list")).toBe("admin");
    expect(handleMock).toHaveBeenCalledTimes(1);
    expect(handleMock.mock.calls[0][0]).toBe("thing_list");
  });

  it("refuses a duplicate name", () => {
    defineCommand("thing_list", { tier: "admin", handler: () => null });
    expect(() =>
      defineCommand("thing_list", { tier: "admin", handler: () => null }),
    ).toThrow(/duplicate/);
  });

  it("agrees with the ipcMain registrations", () => {
    defineCommand("a_one", { tier: "admin", handler: () => null });
    defineCommand("a_two", { tier: "host", handler: () => null });

    const viaIpc = handleMock.mock.calls.map((c) => c[0] as string).sort();
    expect(
      listCommands()
        .map((c) => c.name)
        .sort(),
    ).toEqual(viaIpc);
  });

  it("groups commands by tier", () => {
    defineCommand("a_one", { tier: "admin", handler: () => null });
    defineCommand("a_two", { tier: "host", handler: () => null });

    expect(commandNamesForTier("host")).toEqual(["a_two"]);
    expect(commandNamesForTier("admin")).toEqual(["a_one"]);
    expect(commandNamesForTier("monitor")).toEqual([]);
  });
});

describe("invokeCommand", () => {
  beforeEach(() => {
    resetCommandRegistry();
    handleMock.mockClear();
  });

  it("passes args through and returns the handler's value", async () => {
    defineCommand("echo_args", { tier: "admin", handler: (args) => args });
    await expect(invokeCommand("echo_args", { a: 1 })).resolves.toEqual({
      a: 1,
    });
  });

  it("defaults missing args to an empty object", async () => {
    defineCommand("echo_args", { tier: "admin", handler: (args) => args });
    await expect(invokeCommand("echo_args", undefined)).resolves.toEqual({});
  });

  it("throws the handler's own error untouched", async () => {
    const boom = new Error("nope");
    defineCommand("explode", {
      tier: "admin",
      handler: () => {
        throw boom;
      },
    });
    await expect(invokeCommand("explode", {})).rejects.toBe(boom);
  });

  it("rejects an unknown command", async () => {
    await expect(invokeCommand("no_such", {})).rejects.toThrow(
      /unknown command/,
    );
  });
});

const ipcSource = fs.readFileSync(
  path.resolve(__dirname, "../../ipc.ts"),
  "utf-8",
);

const REGISTRATION_RE = /\b(?:toolHandle|handle)\(\s*"([a-z0-9_]+)"/g;
const TIERED_RE =
  /\b(?:toolHandle|handle)\(\s*"([a-z0-9_]+)",\s*"(host|monitor|control|admin)"/g;

describe("ipc.ts tier annotations", () => {
  const names = [...ipcSource.matchAll(REGISTRATION_RE)].map((m) => m[1]);
  const tiered = new Map(
    [...ipcSource.matchAll(TIERED_RE)].map((m) => [m[1], m[2]]),
  );

  it("registers a non-trivial number of commands", () => {
    expect(names.length).toBeGreaterThan(300);
  });

  it("gives every command a tier", () => {
    const untiered = names.filter((n) => !tiered.has(n));
    expect(untiered).toEqual([]);
  });

  it("never registers the same command twice", () => {
    const seen = new Set<string>();
    const duplicates = names.filter((n) => (seen.has(n) ? true : !seen.add(n)));
    expect(duplicates).toEqual([]);
  });

  it("puts exactly the host-only commands at the host tier", () => {
    const hostTier = [...tiered]
      .filter(([, tier]) => tier === "host")
      .map(([name]) => name)
      .sort();
    expect(hostTier).toEqual([...HOST_ONLY_COMMANDS].sort());
  });
});
