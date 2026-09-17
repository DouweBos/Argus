/**
 * The admin tier: raw command passthrough for a paired Mac, bounded by the
 * registry's tier. monitor/control must stay on the strict allowlist, and the
 * host-tier registrations in `ipc.ts` must still match `HOST_ONLY_COMMANDS` —
 * a rename there would otherwise silently open a hole.
 */

import type { GatewayContext } from "./capabilities";
import type { PairedDevice } from "./deviceStore";
import type { CommandArgs, CommandTier } from "../command/registry";
import { HOST_ONLY_COMMANDS, REMOTE_METHODS } from "@argus/remote-protocol";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
}));
vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));
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
const { defineCommand } = await import("../command/registry");

const { releaseDevice } = await import("./deviceClaims");
const { resolveMentionPath } = await import("../file/operations");
const { collectAllProjects } = await import("../mcp/projects");
const { GitError } = await import("../session/gitError");

/** Stand-in for the real registrations made by `registerIpcHandlers()`. */
const FIXTURES: [string, CommandTier, (args: CommandArgs) => unknown][] = [
  ["list_projects", "admin", (args) => ({ args, ok: true })],
  ["show_open_dialog", "host", () => ({ paths: [] })],
  [
    "boom",
    "admin",
    () => {
      throw "nope";
    },
  ],
  [
    "resolve_mention_path",
    "admin",
    () => ({
      entries: [{ name: "unconfined", is_dir: false }],
      resolvedPath: "/etc",
    }),
  ],
  ["simulator_touch", "admin", () => null],
  [
    "git_boom",
    "admin",
    () => {
      throw new GitError("merge-conflict", "merge conflict", {
        recovery: "resolve it",
      });
    },
  ],
];

const fixtureNames = FIXTURES.map(([name, tier, handler]) => {
  defineCommand(name, { tier, handler });

  return name;
});

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
    connectionId: "conn-1",
    outstandingPermissions: new Set(),
  };
}

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

/** Every `defineCommand` registration in `ipc.ts`, with its declared tier. */
const declaredTiers = new Map(
  [
    ...ipcSource.matchAll(
      /\b(?:toolHandle|handle)\(\s*"([a-z0-9_]+)",\s*"(host|monitor|control|admin)"/g,
    ),
  ].map((m) => [m[1], m[2]]),
);

describe("host-only denylist", () => {
  it("matches the commands registered at the host tier", () => {
    const hostTier = [...declaredTiers]
      .filter(([, tier]) => tier === "host")
      .map(([name]) => name)
      .sort();
    expect(hostTier).toEqual([...HOST_ONLY_COMMANDS].sort());
  });

  it("keeps updater_get_state remotable", () => {
    expect(HOST_ONLY_COMMANDS.has("updater_get_state")).toBe(false);
    expect(declaredTiers.get("updater_get_state")).toBe("admin");
  });
});

describe("admin passthrough dispatch", () => {
  it("registers every fixture command", () => {
    expect(fixtureNames).toHaveLength(FIXTURES.length);
  });

  it("invokes a raw IPC command for an admin device", async () => {
    const res = await dispatch(
      "list_projects",
      { a: 1 },
      makeCtx(["monitor", "control", "admin"]),
    );
    expect(res).toEqual({ args: { a: 1 }, ok: true });
  });

  it("refuses host-only commands even for admin", async () => {
    await expect(
      dispatch("show_open_dialog", {}, makeCtx(["monitor", "admin"])),
    ).rejects.toMatchObject({ code: "capability_denied" });
  });

  it("keeps host-tier commands unreachable at every tier", async () => {
    for (const caps of [
      ["monitor"],
      ["monitor", "control"],
      ["monitor", "control", "admin"],
    ] as const) {
      await expect(
        dispatch("show_open_dialog", {}, makeCtx([...caps])),
      ).rejects.toMatchObject({ code: "capability_denied" });
    }
  });

  it("reports an unregistered command as not_found", async () => {
    await expect(
      dispatch("no_such_command", {}, makeCtx(["monitor", "admin"])),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("maps a throwing handler to a wire error", async () => {
    await expect(
      dispatch("boom", {}, makeCtx(["monitor", "admin"])),
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it("carries a GitError envelope in the wire error's data", async () => {
    await expect(
      dispatch("git_boom", {}, makeCtx(["monitor", "admin"])),
    ).rejects.toMatchObject({
      code: "bad_request",
      message: "merge conflict",
      data: {
        __gitError: true,
        kind: "merge-conflict",
        recovery: "resolve it",
      },
    });
  });

  it("does not widen monitor or control", async () => {
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

describe("admin passthrough guards", () => {
  it("confines the @-mention browse to registered projects", async () => {
    vi.mocked(collectAllProjects).mockReturnValue([
      { path: "/repo", name: "repo" },
    ] as never);

    const res = await dispatch(
      "resolve_mention_path",
      { id: "s1", query: "/etc/" },
      makeCtx(["monitor", "admin"]),
    );

    expect(resolveMentionPath).toHaveBeenCalledWith("s1", "/etc/", ["/repo"]);
    expect(res).toEqual({ entries: [], resolvedPath: "" });
  });

  it("arbitrates raw HID between two admin devices", async () => {
    const first = makeCtx(["monitor", "admin"]);
    const second = { ...makeCtx(["monitor", "admin"]), connectionId: "conn-2" };

    await dispatch("simulator_touch", { udid: "sim-1", x: 1, y: 2 }, first);
    await expect(
      dispatch("simulator_touch", { udid: "sim-1", x: 3, y: 4 }, second),
    ).rejects.toMatchObject({ code: "capability_denied" });

    releaseDevice("sim-1", "conn-1");
  });
});
