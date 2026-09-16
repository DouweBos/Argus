/**
 * The admin tier: raw IPC passthrough for a paired Mac, bounded by the
 * host-only denylist. monitor/control must stay on the strict allowlist, and
 * every denylisted name must still exist in `ipc.ts` — a rename there would
 * otherwise silently open a hole.
 */

import type { GatewayContext } from "./capabilities";
import type { PairedDevice } from "./deviceStore";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { HOST_ONLY_COMMANDS, REMOTE_METHODS } from "@argus/remote-protocol";

/** Stand-in for the real registrations made by `registerIpcHandlers()`. */
const invokeHandlers = new Map<
  string,
  (event: unknown, args: unknown) => unknown
>();
vi.mock("electron", () => ({
  ipcMain: { _invokeHandlers: invokeHandlers },
  safeStorage: { isEncryptionAvailable: () => false },
}));
vi.mock("../../broadcast", () => ({ broadcastToRenderers: vi.fn() }));
vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentSnapshots: new Map<string, string>(),
    agentPendingPermissions: new Map(),
    sessions: new Map(),
  },
}));
vi.mock("../agent/agentService", () => ({
  respondToPermission: vi.fn(),
  sendAgentMessage: vi.fn(),
  interruptAgent: vi.fn(),
  stopAgent: vi.fn(),
  setAgentModel: vi.fn(),
  setAgentPermissionMode: vi.fn(),
  setAgentEffort: vi.fn(),
  startAgent: vi.fn(async () => ({ agent_id: "a1" })),
}));
vi.mock("../file/operations", () => ({
  listSessionFiles: vi.fn(async () => []),
  resolveMentionPath: vi.fn(async () => ({ entries: [], resolvedPath: "" })),
}));
vi.mock("../mcp/projects", () => ({ collectAllProjects: vi.fn(() => []) }));
vi.mock("../session/manager", () => ({
  listSessions: vi.fn(async () => []),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  renameSession: vi.fn(),
  renameSessionBranch: vi.fn(),
}));
vi.mock("../session/sessionOps", () => ({
  getSessionBranchDiff: vi.fn(async () => ""),
  getSessionFullDiff: vi.fn(async () => ""),
}));
vi.mock("../organization/manager", () => ({
  listOrganizations: vi.fn(() => []),
}));

const { dispatch, GatewayError } = await import("./capabilities");

function makeCtx(capabilities: PairedDevice["capabilities"]): GatewayContext {
  return {
    device: {
      device_id: "dev-1",
      label: "Mac mini",
      dev_static_pub: "",
      capabilities,
      created_at: 0,
      last_seen: null,
    },
    outstandingPermissions: new Set(),
  };
}

const ipcSource = fs.readFileSync(
  path.resolve(__dirname, "../../ipc.ts"),
  "utf-8",
);

/** Command names registered in `ipc.ts`, via `handle()` or `toolHandle()`. */
const registered = new Set(
  [...ipcSource.matchAll(/\b(?:toolHandle|handle)\(\s*"([a-z0-9_]+)"/g)].map(
    (m) => m[1],
  ),
);

describe("host-only denylist", () => {
  it("only names commands that still exist in ipc.ts", () => {
    const missing = [...HOST_ONLY_COMMANDS].filter((c) => !registered.has(c));
    expect(missing).toEqual([]);
  });

  it("keeps updater_get_state remotable", () => {
    expect(HOST_ONLY_COMMANDS.has("updater_get_state")).toBe(false);
    expect(registered.has("updater_get_state")).toBe(true);
  });
});

describe("admin passthrough dispatch", () => {
  it("invokes a raw IPC command for an admin device", async () => {
    invokeHandlers.set("list_projects", (_e, args) => ({ args, ok: true }));
    const res = await dispatch(
      "list_projects",
      { a: 1 },
      makeCtx(["monitor", "control", "admin"]),
    );
    expect(res).toEqual({ args: { a: 1 }, ok: true });
  });

  it("refuses host-only commands even for admin", async () => {
    invokeHandlers.set("show_open_dialog", () => ({ paths: [] }));
    await expect(
      dispatch("show_open_dialog", {}, makeCtx(["monitor", "admin"])),
    ).rejects.toMatchObject({ code: "capability_denied" });
  });

  it("reports an unregistered command as not_found", async () => {
    await expect(
      dispatch("no_such_command", {}, makeCtx(["monitor", "admin"])),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("maps a throwing handler to a wire error", async () => {
    invokeHandlers.set("boom", () => {
      throw "nope";
    });
    await expect(
      dispatch("boom", {}, makeCtx(["monitor", "admin"])),
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it("does not widen monitor or control", async () => {
    invokeHandlers.set("list_projects", () => ({ ok: true }));
    for (const caps of [["monitor"], ["monitor", "control"]] as const) {
      await expect(
        dispatch("list_projects", {}, makeCtx([...caps])),
      ).rejects.toMatchObject({ code: "capability_denied" });
    }
  });

  it("lets admin reach the control-tier allowlist methods", async () => {
    const res = await dispatch(
      "projects.list",
      {},
      makeCtx(["monitor", "admin"]),
    );
    expect(res).toEqual({ projects: [] });
    expect(REMOTE_METHODS["projects.list"]).toBe("monitor");
  });
});

describe("remote permission modes", () => {
  it("never lets a remote request bypassPermissions", async () => {
    await expect(
      dispatch(
        "agents.set_permission_mode",
        { agent_id: "a1", mode: "trusted" },
        makeCtx(["monitor", "control"]),
      ),
    ).rejects.toBeInstanceOf(GatewayError);
  });
});
