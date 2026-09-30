/**
 * The headless proof.
 *
 * Boots the host core under plain Node with `nodeHostPlatform()` installed —
 * no Electron, no window, no renderer — and exercises the seams that used to
 * reach for one: the command registry dispatches, the event bus fans out, and
 * every platform capability degrades to a documented no-op instead of
 * throwing. This is what a Linux host or `argus-cli` process would do.
 */

import { COMMANDS, SHELL_COMMANDS } from "@argus/remote-protocol";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addHostEventSink, emitHostEvent, resetHostEventSinks } from "./bus";
import { hostPlatform, nodeHostPlatform, setHostPlatform } from "./platform";
import {
  defineCommand,
  dispatchCommand,
  resetCommandRegistry,
} from "./services/command/registry";
import { appState } from "./state";

describe("headless host", () => {
  afterEach(() => {
    resetCommandRegistry();
    resetHostEventSinks();
  });

  it("loads the service layer without a desktop shell", async () => {
    setHostPlatform(nodeHostPlatform());

    // Importing is the assertion: any transitive `electron` import would be a
    // module the core cannot resolve off an Electron runtime.
    const [sessions, agents, terminals, files, simulators, gateway] =
      await Promise.all([
        import("./services/session/manager"),
        import("./services/agent/agentService"),
        import("./services/terminal/multiplexer"),
        import("./services/file/operations"),
        import("./services/simulator/ios"),
        import("./services/remote/remoteService"),
      ]);

    expect(typeof sessions.listSessions).toBe("function");
    expect(typeof agents.listAgents).toBe("function");
    expect(typeof terminals.createTerminal).toBe("function");
    expect(typeof files.readFile).toBe("function");
    expect(typeof simulators.activeSimulator).toBe("function");
    expect(typeof gateway.getRemoteStatus).toBe("function");
    expect(appState.sessions.size).toBe(0);
  });

  it("dispatches commands with no binder installed", async () => {
    defineCommand("headless_echo", {
      tier: "admin",
      handler: (args) => args.value,
    });

    await expect(dispatchCommand("headless_echo", { value: 42 })).resolves.toBe(
      42,
    );
  });

  it("fans events out to whatever transports are attached", () => {
    const seen: string[] = [];
    addHostEventSink((channel) => seen.push(channel));
    emitHostEvent("session:updated", { id: "s1" });

    expect(seen).toEqual(["session:updated"]);
  });

  it("degrades every desktop capability to a no-op", async () => {
    setHostPlatform(nodeHostPlatform());
    const platform = hostPlatform();

    expect(platform.hasUi).toBe(false);
    expect(platform.notificationsSupported()).toBe(false);
    expect(platform.isForeground()).toBe(false);
    expect(platform.secretStorage.isAvailable()).toBe(false);
    // Callers fall back to their plaintext path, so the round trip must work.
    expect(
      platform.secretStorage.decrypt(platform.secretStorage.encrypt("t")),
    ).toBe("t");

    await expect(
      platform.openExternal("https://example.com"),
    ).resolves.toBeUndefined();
    await expect(platform.openPath("/tmp")).resolves.toBe("");
    expect(() => {
      platform.revealInFinder("/tmp");
      platform.notify({ title: "t", body: "b" });
      platform.closeDevicePopout("ios:UDID");
      platform.focusUi();
    }).not.toThrow();
  });

  /**
   * The real boot, in-process: state restore, automations, MCP, the gateway
   * and every host command — with a throwaway home so nothing touches yours.
   */
  it("boots and shuts down the whole host", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-headless-"));
    const port = await freePort();
    vi.stubEnv("ARGUS_HOME", home);
    vi.stubEnv("ARGUS_REMOTE_PORT", String(port));
    vi.resetModules();
    // Don't let the test sweep up processes belonging to a running Argus.
    vi.doMock("./services/agent/reapOrphans", () => ({
      reapOrphanedAgentProcesses: async () => undefined,
    }));
    vi.doMock("./services/terminal/reapOrphans", () => ({
      reapOrphanedSpawnHelpers: async () => undefined,
    }));
    const platform = await import("./platform");
    platform.setHostPlatform(platform.nodeHostPlatform());
    const boot = await import("./boot");
    const registry = await import("./services/command/registry");

    try {
      await boot.startHost({ forceRemote: true }).remoteReady;

      const registered = registry
        .listCommands()
        .map((c) => c.name)
        .sort();
      const hostCatalog = Object.keys(COMMANDS)
        .filter((name) => !Object.hasOwn(SHELL_COMMANDS, name))
        .sort();
      expect(registered).toEqual(hostCatalog);
      await expect(canConnect(port)).resolves.toBe(true);
    } finally {
      await boot.shutdownHost();
      vi.unstubAllEnvs();
      fs.rmSync(home, { recursive: true, force: true });
    }
    await expect(canConnect(port)).resolves.toBe(false);
  }, 30_000);
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}
