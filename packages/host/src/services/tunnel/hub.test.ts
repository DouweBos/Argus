import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PortTunnelHub } from "./hub";
import {
  TUNNEL_CLOSE,
  TUNNEL_DATA,
  decodeTunnel,
  encodeTunnel,
  type TunnelMessage,
} from "./protocol";

function makeHub(sessions = ["s1"]) {
  const received: TunnelMessage[] = [];
  const hub = new PortTunnelHub(
    {
      send: (body) => {
        const msg = decodeTunnel(body);
        if (msg) {
          received.push({ ...msg, payload: Uint8Array.from(msg.payload) });
        }
      },
      buffered: () => 0,
    },
    {
      connect: (p) => net.connect({ host: "127.0.0.1", port: p }),
      sessionExists: (id) => sessions.includes(id),
    },
  );

  return { hub, received };
}

const text = (msgs: TunnelMessage[], id: number) =>
  msgs
    .filter((m) => m.tunnelId === id && m.type === TUNNEL_DATA)
    .map((m) => Buffer.from(m.payload).toString())
    .join("");

async function until(check: () => boolean): Promise<boolean> {
  for (let i = 0; i < 200 && !check(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  return check();
}

describe("port tunnel hub", () => {
  let server: net.Server;
  let port: number;
  let serverSockets: net.Socket[];

  beforeEach(async () => {
    serverSockets = [];
    server = net.createServer((socket) => {
      serverSockets.push(socket);
      socket.on("data", (chunk) => socket.write(`echo:${chunk.toString()}`));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    port = (server.address() as net.AddressInfo).port;
  });

  afterEach(async () => {
    for (const socket of serverSockets) {
      socket.destroy();
    }
    await new Promise((resolve) => server.close(resolve));
  });

  it("pipes bytes both ways", async () => {
    const { hub, received } = makeHub();
    await hub.open({ tunnel_id: 7, session_id: "s1", port });
    hub.onBody(encodeTunnel(TUNNEL_DATA, 7, Buffer.from("hello")));
    await expect(until(() => text(received, 7) === "echo:hello")).resolves.toBe(
      true,
    );
    hub.dispose();
  });

  it("tells the client when the server closes", async () => {
    const { hub, received } = makeHub();
    await hub.open({ tunnel_id: 1, session_id: "s1", port });
    await expect(until(() => serverSockets.length === 1)).resolves.toBe(true);
    serverSockets[0].destroy();
    await expect(
      until(() => received.some((m) => m.type === TUNNEL_CLOSE)),
    ).resolves.toBe(true);
    expect(hub.size).toBe(0);
  });

  it("keeps reading after the client half-closes", async () => {
    const { hub, received } = makeHub();
    await hub.open({ tunnel_id: 2, session_id: "s1", port });
    hub.onBody(encodeTunnel(TUNNEL_DATA, 2, Buffer.from("req")));
    hub.onBody(encodeTunnel(TUNNEL_CLOSE, 2));
    await expect(until(() => text(received, 2) === "echo:req")).resolves.toBe(
      true,
    );
    hub.dispose();
  });

  it("closes a deleted session's tunnels", async () => {
    const { hub, received } = makeHub(["s1", "s2"]);
    await hub.open({ tunnel_id: 1, session_id: "s1", port });
    await hub.open({ tunnel_id: 2, session_id: "s2", port });
    hub.closeSession("s1");
    expect(hub.size).toBe(1);
    expect(received).toContainEqual(
      expect.objectContaining({ type: TUNNEL_CLOSE, tunnelId: 1 }),
    );
    hub.dispose();
  });

  it("rejects a closed port, an unknown session and a reused id", async () => {
    const { hub } = makeHub();
    const closed = net.createServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
    const deadPort = (closed.address() as net.AddressInfo).port;
    await new Promise((r) => closed.close(r));

    await expect(
      hub.open({ tunnel_id: 1, session_id: "s1", port: deadPort }),
    ).rejects.toMatch(/Nothing is listening/);
    await expect(
      hub.open({ tunnel_id: 1, session_id: "nope", port }),
    ).rejects.toBe("Unknown session");
    await expect(
      hub.open({ tunnel_id: 1, session_id: "s1", port: 70000 }),
    ).rejects.toBe("Invalid port");
    await hub.open({ tunnel_id: 1, session_id: "s1", port });
    await expect(
      hub.open({ tunnel_id: 1, session_id: "s1", port }),
    ).rejects.toMatch(/already open/);
    hub.dispose();
  });
});
