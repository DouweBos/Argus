import type { PairedDevice } from "./deviceStore";
import type { Envelope, RemoteAgentStatus } from "@argus/remote-protocol";
import { describe, expect, it, vi } from "vitest";
import { generateKeypair, NoiseHandshake } from "./noise";

vi.mock("../../state", () => ({
  appState: {
    agents: new Map([["a1", { agentId: "a1" }]]),
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
vi.mock("../agent/conversation/live", async (orig) => ({
  ...(await orig<object>()),
  liveMeta: vi.fn(() => ({})),
}));

let awaiting: RemoteAgentStatus["awaiting"] = null;
vi.mock("./capabilities", async (orig) => ({
  ...(await orig<object>()),
  agentAwaiting: vi.fn(() => awaiting),
  toRemoteAgentStatus: vi.fn(
    (): RemoteAgentStatus => ({
      agent_id: "a1",
      session_id: "s1",
      status: "running",
      awaiting,
    }),
  ),
}));

const { DeviceConnection } = await import("./gateway");

const device: PairedDevice = {
  device_id: "dev-1",
  label: "Phone",
  dev_static_pub: "",
  capabilities: ["control"],
  created_at: 0,
  last_seen: null,
};

async function subscribed() {
  const client = generateKeypair();
  const desktop = generateKeypair();
  const ci = new NoiseHandshake({
    role: "initiator",
    staticKey: client,
    remoteStatic: desktop.pub,
  });
  const ri = new NoiseHandshake({ role: "responder", staticKey: desktop });
  ri.readMessage(ci.writeMessage(new Uint8Array(0)));
  ci.readMessage(ri.writeMessage(new Uint8Array(0)));
  const clientSession = ci.session();
  const statuses: RemoteAgentStatus[] = [];
  const conn = new DeviceConnection(device, ri.session(), (bytes) => {
    const env = JSON.parse(
      new TextDecoder().decode(clientSession.decrypt(bytes).subarray(1)),
    ) as Envelope & { event?: string; payload?: unknown };
    if (env.event === "agent.status") {
      statuses.push(env.payload as RemoteAgentStatus);
    }
  });
  const json = new TextEncoder().encode(
    JSON.stringify({
      seq: 0,
      type: "sub",
      action: "subscribe",
      agent_id: "a1",
    }),
  );
  await conn.onFrame(clientSession.encrypt(new Uint8Array([0, ...json])));

  return { conn, statuses };
}

const delta = { agentId: "a1", epoch: 1, revision: 1, total: 1, ops: [] };

describe("agent status awaiting", () => {
  it("re-publishes the status when a mid-turn answer clears the prompt", async () => {
    const { conn, statuses } = await subscribed();
    awaiting = "question";
    conn.handleBroadcast("agent:status:a1", ["running"]);
    expect(statuses.at(-1)?.awaiting).toBe("question");

    conn.handleBroadcast("agent:transcript:a1", [delta]);
    expect(statuses).toHaveLength(1);

    awaiting = null;
    conn.handleBroadcast("agent:transcript:a1", [delta]);
    expect(statuses).toHaveLength(2);
    expect(statuses.at(-1)?.awaiting).toBeNull();
  });
});
