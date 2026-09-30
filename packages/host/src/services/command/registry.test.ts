/**
 * The command registry: one table behind local IPC and the wire.
 *
 * Two things must hold. Structurally, every `defineCommand` reaches the local
 * transport binder under the same name, so the renderer and the gateway can
 * never see different command sets. Statically, every registration in
 * `ipc.ts` carries a tier, and the host-tier ones are exactly the names the
 * shared `HOST_ONLY_COMMANDS` set promises never cross the wire.
 */

import { HOST_ONLY_COMMANDS } from "@argus/remote-protocol";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GitError } from "../session/gitError";
import {
  CommandParamsError,
  commandNamesForTier,
  defineCommand,
  dispatchCommand,
  getCommand,
  getCommandTier,
  hasCommand,
  invokeCommand,
  listCommands,
  resetCommandRegistry,
  setCommandBinder,
} from "./registry";

vi.mock("../tools/state", () => ({
  toolEnabled: (id: string) => id !== "device-debug",
}));

/** Stands in for `ipcMain.handle` — the desktop's binder. */
const bindMock = vi.fn();

describe("defineCommand", () => {
  beforeEach(() => {
    resetCommandRegistry();
    bindMock.mockClear();
    setCommandBinder(({ name }) => bindMock(name));
  });

  it("records the definition and binds it on the local transport", () => {
    defineCommand("thing_list", { tier: "admin", handler: () => ["a"] });

    expect(getCommand("thing_list")).toMatchObject({
      name: "thing_list",
      tier: "admin",
    });
    expect(hasCommand("thing_list")).toBe(true);
    expect(getCommandTier("thing_list")).toBe("admin");
    expect(bindMock).toHaveBeenCalledTimes(1);
    expect(bindMock.mock.calls[0][0]).toBe("thing_list");
  });

  it("refuses a duplicate name", () => {
    defineCommand("thing_list", { tier: "admin", handler: () => null });
    expect(() =>
      defineCommand("thing_list", { tier: "admin", handler: () => null }),
    ).toThrow(/duplicate/);
  });

  it("agrees with what reached the binder", () => {
    defineCommand("a_one", { tier: "admin", handler: () => null });
    defineCommand("a_two", { tier: "host", handler: () => null });

    const bound = bindMock.mock.calls.map((c) => c[0] as string).sort();
    expect(
      listCommands()
        .map((c) => c.name)
        .sort(),
    ).toEqual(bound);
  });

  it("replays commands defined before the binder was installed", () => {
    setCommandBinder(null);
    defineCommand("a_one", { tier: "admin", handler: () => null });
    expect(bindMock).not.toHaveBeenCalled();

    setCommandBinder(({ name }) => bindMock(name));
    expect(bindMock.mock.calls.map((c) => c[0] as string)).toEqual(["a_one"]);
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
    bindMock.mockClear();
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

describe("dispatchCommand", () => {
  beforeEach(() => {
    resetCommandRegistry();
  });

  it("returns the handler's value", async () => {
    defineCommand("echo_args", { tier: "admin", handler: (args) => args });
    await expect(dispatchCommand("echo_args", { a: 1 })).resolves.toEqual({
      a: 1,
    });
  });

  it("flattens GitError into own enumerable props IPC can carry", async () => {
    defineCommand("git_boom", {
      tier: "admin",
      handler: () => {
        throw new GitError("merge-conflict", "merge failed", {
          stderr: "CONFLICT",
        });
      },
    });

    const err = await dispatchCommand("git_boom").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GitError);
    expect({ ...(err as object) }).toMatchObject({
      __gitError: true,
      kind: "merge-conflict",
      stderr: "CONFLICT",
    });
  });

  it("rejects an unknown command", async () => {
    await expect(dispatchCommand("no_such")).rejects.toThrow(/unknown command/);
  });
});

describe("schema'd commands", () => {
  const params = z.object({ id: z.string(), count: z.number().default(3) });

  beforeEach(() => {
    resetCommandRegistry();
  });

  it("hands the handler parsed params with defaults applied", async () => {
    defineCommand("typed_echo", {
      tier: "admin",
      params,
      handler: (args) => args,
    });
    await expect(
      invokeCommand("typed_echo", { id: "a", extra: true }),
    ).resolves.toEqual({ id: "a", count: 3 });
  });

  it("rejects malformed params over the gateway path", async () => {
    defineCommand("typed_echo", { tier: "admin", params, handler: () => 1 });
    const err = await invokeCommand("typed_echo", { id: 7 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CommandParamsError);
    expect((err as CommandParamsError).issues[0]?.path).toBe("id");
  });

  it("flattens a params error for local IPC", async () => {
    const handler = vi.fn();
    defineCommand("typed_echo", { tier: "admin", params, handler });
    const err = await dispatchCommand("typed_echo", {}).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(CommandParamsError);
    expect((err as Error).message).toMatch(/invalid params for typed_echo/);
    expect({ ...(err as object) }).toMatchObject({
      code: "bad_request",
      issues: [{ path: "id" }],
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses to run a command whose tool is disabled", async () => {
    const handler = vi.fn();
    defineCommand("gated", { tier: "admin", tool: "device-debug", handler });
    await expect(invokeCommand("gated", {})).rejects.toBe(
      "tool disabled: device-debug",
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("fails a test run when the result drifts from its schema", async () => {
    defineCommand("drifted", {
      tier: "admin",
      result: z.object({ ok: z.boolean() }),
      handler: () => ({ ok: "yes" }),
    });
    await expect(invokeCommand("drifted", {})).rejects.toThrow(
      /does not match its schema/,
    );
  });
});

/**
 * `ipc.ts` is migrating into `@argus/host`, so resolve it from either home.
 * Throwing beats defaulting to empty: these guards are the only thing stopping
 * a rename from silently opening a hole, so they must never quietly no-op.
 */
function readIpcSource(): string {
  const candidates = [
    path.resolve(__dirname, "../../ipc.ts"),
    path.resolve(__dirname, "../../../../../electron/ipc.ts"),
  ];
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) {
    throw new Error(`ipc.ts not found; looked in ${candidates.join(", ")}`);
  }

  return fs.readFileSync(found, "utf-8");
}

const ipcSource = readIpcSource();

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
