/**
 * Automations over the wire. The headless mini is the machine that runs the
 * clock, so a paired desktop must see the host's automations, runs and
 * proposals as if they were its own — and a huddle guest must see none of it.
 *
 * Three things are asserted, all of them empirically rather than by reading
 * the source: the family's commands are admin-tier and never host-only, their
 * events actually leave the host bus and reach an admin connection, and a
 * scoped grant reaches neither the commands nor the events.
 */

import type { PairedDevice } from "./deviceStore";
import type { Envelope, GrantScope } from "@argus/remote-protocol";
import { HOST_ONLY_COMMANDS } from "@argus/remote-protocol";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeypair, NoiseHandshake, type NoiseSession } from "./noise";

vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentSnapshots: new Map(),
    agentPendingPermissions: new Map(),
    sessions: new Map(),
  },
}));
vi.mock("../agent/agentService", () => ({
  listAgents: vi.fn(() => []),
  respondToPermission: vi.fn(),
}));
vi.mock("../mcp/projects", () => ({ collectAllProjects: vi.fn(() => []) }));
vi.mock("../session/manager", () => ({ listSessions: vi.fn(async () => []) }));
vi.mock("../session/sessionOps", () => ({
  getSessionBranchDiff: vi.fn(async () => ""),
  getSessionFullDiff: vi.fn(async () => ""),
}));

// Deliberately NOT mocked: the point is to drive the real bus end to end.
const { emitHostEvent, resetHostEventSinks } = await import("@argus/host/bus");
const { addConnection, clearConnections, DeviceConnection } =
  await import("./gateway");
const { dispatch, GatewayError } = await import("./capabilities");

const dec = new TextDecoder();

const baseDevice: PairedDevice = {
  device_id: "mac-1",
  label: "Studio",
  dev_static_pub: "",
  capabilities: ["admin"],
  created_at: 0,
  last_seen: null,
};

const SCOPE: GrantScope = { agent_ids: ["ag1"], device_keys: [] };

function connect(
  capabilities: PairedDevice["capabilities"],
  scope?: GrantScope,
) {
  const client = generateKeypair();
  const host = generateKeypair();
  const ci = new NoiseHandshake({
    role: "initiator",
    staticKey: client,
    remoteStatic: host.pub,
  });
  const ri = new NoiseHandshake({ role: "responder", staticKey: host });
  ri.readMessage(ci.writeMessage(new Uint8Array(0)));
  ci.readMessage(ri.writeMessage(new Uint8Array(0)));
  const clientSession: NoiseSession = ci.session();

  const fromGateway: Envelope[] = [];
  const conn = new DeviceConnection(
    { ...baseDevice, capabilities },
    ri.session(),
    (bytes) => {
      fromGateway.push(
        JSON.parse(
          dec.decode(clientSession.decrypt(bytes).subarray(1)),
        ) as Envelope,
      );
    },
    scope,
  );

  return { conn, fromGateway };
}

/** The `ipc` frames a raw (admin) connection carries, by channel. */
const channels = (sent: Envelope[]): string[] =>
  sent
    .filter((e) => (e as { event?: string }).event === "ipc")
    .map(
      (e) => (e as unknown as { payload: { channel: string } }).payload.channel,
    );

/** `ipc.ts` is migrating into `@argus/host`; resolve it from either home. */
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

const declaredTiers = new Map(
  [
    ...readIpcSource().matchAll(
      /\b(?:toolHandle|handle)\(\s*"([a-z0-9_]+)",\s*"(host|monitor|control|admin)"/g,
    ),
  ].map((m) => [m[1], m[2]]),
);

/** Everything the automations family registers, read back from `ipc.ts`. */
const AUTOMATION_COMMANDS = [...declaredTiers.keys()].filter((name) =>
  /^(automation|automations|proposal|proposals|signal_sources)_/.test(name),
);

/** Every channel the automation path emits on. */
const AUTOMATION_CHANNELS = [
  "automations:changed",
  "automation_run:changed",
  "proposals:changed",
];

describe("the automations command family", () => {
  it("registers the commands the surfaces need", () => {
    // Guards against the regex quietly matching nothing after a rename.
    expect(AUTOMATION_COMMANDS).toEqual(
      expect.arrayContaining([
        "automations_list",
        "automation_create",
        "automation_run_now",
        "automation_runs_list",
        "automation_calibration",
        "proposals_list",
        "proposal_accept",
        "signal_sources_list",
      ]),
    );
  });

  it("puts every one of them at the admin tier", () => {
    const wrong = AUTOMATION_COMMANDS.filter(
      (name) => declaredTiers.get(name) !== "admin",
    );
    expect(wrong).toEqual([]);
  });

  /**
   * Automations are host state. A desktop driving a headless mini must manage
   * the mini's automations, so none of these may be host-only.
   */
  it("keeps every one of them remotable", () => {
    const blocked = AUTOMATION_COMMANDS.filter((name) =>
      HOST_ONLY_COMMANDS.has(name),
    );
    expect(blocked).toEqual([]);
  });
});

describe("automation events on the wire", () => {
  beforeEach(() => {
    resetHostEventSinks();
    clearConnections();
  });
  afterEach(() => {
    clearConnections();
    resetHostEventSinks();
  });

  it("reaches a paired admin device through the host bus", () => {
    const { conn, fromGateway } = connect(["admin"]);
    addConnection(conn);

    emitHostEvent("automations:changed", [{ id: "a1" }]);
    emitHostEvent("automation_run:changed", { id: "r1", status: "running" });
    emitHostEvent("proposals:changed", [{ id: "p1" }]);

    expect(channels(fromGateway)).toEqual(AUTOMATION_CHANNELS);
  });

  it("carries the payload verbatim", () => {
    const { conn, fromGateway } = connect(["admin"]);
    addConnection(conn);

    emitHostEvent("automation_run:changed", { id: "r1", status: "succeeded" });

    expect((fromGateway[0] as unknown as { payload: unknown }).payload).toEqual(
      {
        channel: "automation_run:changed",
        args: [{ id: "r1", status: "succeeded" }],
      },
    );
  });

  /**
   * A huddle guest is control-tier and scoped, so it never gets the raw
   * broadcast path — and none of these channels is an agent channel, so there
   * is no typed mirror either.
   */
  it("never reaches a scoped huddle guest", () => {
    const { conn, fromGateway } = connect(["monitor", "control"], SCOPE);
    addConnection(conn);

    for (const channel of AUTOMATION_CHANNELS) {
      emitHostEvent(channel, [{ id: "x" }]);
    }

    expect(fromGateway).toEqual([]);
  });

  it("never reaches an unscoped phone either", () => {
    const { conn, fromGateway } = connect(["monitor", "control"]);
    addConnection(conn);

    for (const channel of AUTOMATION_CHANNELS) {
      emitHostEvent(channel, [{ id: "x" }]);
    }

    expect(fromGateway).toEqual([]);
  });
});

describe("automation commands and a scoped grant", () => {
  const denied = async (command: string, capabilities: Capability[]) => {
    try {
      await dispatch(command, {}, {
        device: { ...baseDevice, capabilities },
        connectionId: "conn-1",
        scope: SCOPE,
        outstandingPermissions: new Set<string>(),
        media: {
          watch: async () => 1,
          unwatch: () => undefined,
          watchBrowser: () => 2,
          unwatchBrowser: () => undefined,
        },
      } as Parameters<typeof dispatch>[2]);
    } catch (err) {
      return err instanceof GatewayError ? err.code : "not-a-gateway-error";
    }

    return "allowed";
  };

  it("refuses every automation command to a huddle guest", async () => {
    for (const command of AUTOMATION_COMMANDS) {
      await expect(denied(command, ["monitor", "control"])).resolves.toBe(
        "capability_denied",
      );
    }
  });

  /**
   * Even if an admin grant somehow got scoped, the passthrough stays shut —
   * the one hole that would hand a guest the host's whole automation surface.
   */
  it("refuses them to a scoped grant that still claims admin", async () => {
    for (const command of AUTOMATION_COMMANDS) {
      await expect(
        denied(command, ["admin", "control", "monitor"]),
      ).resolves.toBe("capability_denied");
    }
  });
});

type Capability = PairedDevice["capabilities"][number];
