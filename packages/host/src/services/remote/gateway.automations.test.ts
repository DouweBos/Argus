/**
 * Automations over the wire. The headless mini is the machine that runs the
 * clock, so a paired desktop must see the host's automations, runs and
 * proposals as if they were its own — and a huddle guest must see none of it.
 *
 * Asserted empirically: the family's events actually leave the host bus and
 * reach an admin connection, and a scoped grant reaches neither the commands
 * nor the events. That the commands are admin-tier and never host-only is
 * asserted in `electron/shellCommands.test.ts`.
 */

import type { PairedDevice } from "./deviceStore";
import type {
  Envelope,
  GrantScope,
  RemoteMethod,
} from "@argus/remote-protocol";
import {
  ALL_REMOTE_METHODS,
  METHOD_SCOPE,
  REMOTE_METHODS,
} from "@argus/remote-protocol";
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
vi.mock("../mcp/projectDiscovery", () => ({
  collectAllProjects: vi.fn(() => []),
}));
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

/** A sample of the automations family's raw commands. */
const AUTOMATION_COMMANDS = [
  "automations_list",
  "automation_create",
  "automation_run_now",
  "automation_runs_list",
  "automation_calibration",
  "automation_run_scratch",
  "automation_scratch_save",
  "proposals_list",
  "proposal_accept",
  "signal_sources_list",
];

/** Every channel the automation path emits on. */
const AUTOMATION_CHANNELS = [
  "automations:changed",
  "automation_run:changed",
  "proposals:changed",
];

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

/**
 * The typed `automations.*` methods a phone speaks. A paired desktop uses the
 * admin passthrough above; this is the narrow surface, so it gets its own
 * tier and scope assertions rather than riding the command-name ones.
 */
const TYPED_AUTOMATION_METHODS = ALL_REMOTE_METHODS.filter((m) =>
  m.startsWith("automations."),
);

describe("the typed automations methods", () => {
  it("covers reading runs and firing one", () => {
    expect(TYPED_AUTOMATION_METHODS).toEqual(
      expect.arrayContaining([
        "automations.list",
        "automations.runs",
        "automations.run",
        "automations.run_now",
        "automations.cancel_run",
      ]),
    );
  });

  it("covers running a playbook once", () => {
    expect(TYPED_AUTOMATION_METHODS).toEqual(
      expect.arrayContaining([
        "automations.run_scratch",
        "automations.save_scratch_run",
      ]),
    );
    const tier = (m: RemoteMethod) => REMOTE_METHODS[m];
    // An ad-hoc run is an agent on the host, same as any other run.
    expect(tier("automations.run_scratch")).toBe("control");
    expect(tier("automations.save_scratch_run")).toBe("control");
  });

  it("covers authoring one", () => {
    expect(TYPED_AUTOMATION_METHODS).toEqual(
      expect.arrayContaining([
        "automations.get",
        "automations.sources",
        "automations.create",
        "automations.update",
        "automations.delete",
        "automations.set_enabled",
      ]),
    );
  });

  it("reads at monitor and acts at control", () => {
    const tier = (m: RemoteMethod) => REMOTE_METHODS[m];

    expect(tier("automations.list")).toBe("monitor");
    expect(tier("automations.runs")).toBe("monitor");
    expect(tier("automations.run")).toBe("monitor");
    // Clearing a report is recording that you read it, nothing more.
    expect(tier("automations.mark_run_read")).toBe("monitor");
    // Firing one starts an agent on the host, which is code execution.
    expect(tier("automations.run_now")).toBe("control");
    expect(tier("automations.cancel_run")).toBe("control");
    // Reading the editable shape is still reading.
    expect(tier("automations.get")).toBe("monitor");
    expect(tier("automations.sources")).toBe("monitor");
    // A playbook is code that runs unattended, so writing one is control.
    expect(tier("automations.create")).toBe("control");
    expect(tier("automations.update")).toBe("control");
    expect(tier("automations.delete")).toBe("control");
    expect(tier("automations.set_enabled")).toBe("control");
    // Rewriting writes nothing, but it spends the host's LLM on request.
    expect(tier("automations.revise_playbook")).toBe("control");
    // Feedback resumes the run's agent, so it spends and can act.
    expect(tier("automations.run_feedback")).toBe("control");
    // A memory steers every future run, so writing one is control.
    expect(tier("automations.memories")).toBe("monitor");
    expect(tier("automations.save_memory")).toBe("control");
    expect(tier("automations.delete_memory")).toBe("control");
  });

  /** A guest is handed one agent, never the clock that could start more. */
  it("denies every one of them to a scoped grant", () => {
    for (const method of TYPED_AUTOMATION_METHODS) {
      expect(METHOD_SCOPE[method].kind).toBe("denied");
    }
  });
});

/** The inbox over the wire: reading it is one thing, deciding is another. */
describe("the typed proposals methods", () => {
  const PROPOSAL_METHODS = ALL_REMOTE_METHODS.filter((m) =>
    m.startsWith("proposals."),
  );

  it("reads at monitor and decides at control", () => {
    const tier = (m: RemoteMethod) => REMOTE_METHODS[m];

    expect(tier("proposals.list")).toBe("monitor");
    // Accepting builds a worktree and starts an agent; dismissing writes the
    // signal that calibrates the automation. Neither is a read.
    expect(tier("proposals.accept")).toBe("control");
    expect(tier("proposals.dismiss")).toBe("control");
  });

  it("denies every one of them to a scoped grant", () => {
    for (const method of PROPOSAL_METHODS) {
      expect(METHOD_SCOPE[method].kind).toBe("denied");
    }
  });
});

describe("typed automations methods and a huddle guest", () => {
  const call = async (method: string, capabilities: Capability[]) => {
    try {
      await dispatch(method, {}, {
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

  it("refuses them even though the guest holds monitor and control", async () => {
    for (const method of TYPED_AUTOMATION_METHODS) {
      await expect(call(method, ["monitor", "control"])).resolves.toBe(
        "capability_denied",
      );
    }
  });

  it("refuses firing a run to a monitor-only device", async () => {
    // The tier is checked before the scope, so this is the capability talking.
    await expect(call("automations.run_now", ["monitor"])).resolves.toBe(
      "capability_denied",
    );
  });
});
