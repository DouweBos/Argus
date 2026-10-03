/**
 * The local UI socket over a real Unix domain socket: framing, the console's
 * tiers (host included), typed + raw events, and platform delegation.
 */

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

const { emitHostEvent } = await import("@argus/host/bus");
const { defineCommand } = await import("../command/registry");
const { nodeHostPlatform } = await import("../../platform");
const { encodeFrame, frameReader, startLocalUiSocket } =
  await import("./localUiSocket");
const { uiHostPlatform } = await import("./uiHostPlatform");

type Envelope = Record<string, unknown>;

/** A minimal client: length-prefixed, tagged JSON frames over the socket. */
async function connectClient(socketPath: string) {
  const socket = net.createConnection(socketPath);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const inbox: Envelope[] = [];
  const waiters: (() => void)[] = [];
  socket.on(
    "data",
    frameReader(
      (frame) => {
        if (frame[0] === 0x00) {
          inbox.push(JSON.parse(Buffer.from(frame.subarray(1)).toString()));
          waiters.splice(0).forEach((w) => w());
        }
      },
      () => socket.destroy(),
    ),
  );
  let seq = 0;
  const send = (env: Envelope) => {
    const json = Buffer.from(JSON.stringify({ seq: seq++, ...env }));
    socket.write(encodeFrame(Buffer.concat([Buffer.from([0x00]), json])));
  };
  const waitFor = async (match: (e: Envelope) => boolean) => {
    for (;;) {
      const found = inbox.find(match);
      if (found) {
        return found;
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  const request = async (method: string, params: unknown = {}) => {
    const id = `r${seq}`;
    send({ type: "req", id, method, params });

    return waitFor((e) => e.type === "res" && e.id === id);
  };

  return { socket, inbox, send, waitFor, request };
}

describe("local UI socket", () => {
  beforeAll(() => {
    defineCommand("local_ui_host_cmd", {
      tier: "host",
      handler: () => ({ host: true }),
    });
    defineCommand("local_ui_admin_cmd", {
      tier: "admin",
      handler: () => ({ admin: true }),
    });
  });

  let dir: string;
  let socketPath: string;
  let server: Awaited<ReturnType<typeof startLocalUiSocket>>;

  beforeEach(async () => {
    // Short path: sun_path tops out around 104 bytes on macOS.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "aui-"));
    socketPath = path.join(dir, "host.sock");
    server = await startLocalUiSocket(socketPath);
  });

  afterEach(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("is created mode 0600, so only this user can connect", () => {
    expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600);
  });

  it("restores the umask before it yields, so other files keep their modes", async () => {
    await server.close();
    const before = process.umask();
    const starting = startLocalUiSocket(socketPath);
    expect(process.umask()).toBe(before);
    server = await starting;
  });

  it("replaces a stale socket file left by a crashed host", async () => {
    await server.close();
    fs.writeFileSync(socketPath, "");
    server = await startLocalUiSocket(socketPath);
    const client = await connectClient(socketPath);
    expect((await client.request("local_ui_admin_cmd")).ok).toEqual({
      admin: true,
    });
    client.socket.destroy();
  });

  it("serves every tier, host included", async () => {
    const client = await connectClient(socketPath);
    expect((await client.request("local_ui_host_cmd")).ok).toEqual({
      host: true,
    });
    expect((await client.request("local_ui_admin_cmd")).ok).toEqual({
      admin: true,
    });
    client.socket.destroy();
  });

  it("forwards typed agent events and raw broadcasts the typed dialect lacks", async () => {
    const client = await connectClient(socketPath);
    client.send({ type: "sub", action: "subscribe", agent_id: "a1" });
    await client.request("ui.state", { foreground: true });

    emitHostEvent("agent:event:a1", { type: "assistant" });
    emitHostEvent("agent:exit:a1", 0);
    emitHostEvent("session:progress", { id: "s1" });

    const typed = await client.waitFor((e) => e.event === "agent.event");
    expect(typed.payload).toEqual({
      agent_id: "a1",
      event: { type: "assistant" },
    });
    await client.waitFor(
      (e) =>
        e.event === "ipc" &&
        (e.payload as { channel: string }).channel === "agent:exit:a1",
    );
    await client.waitFor((e) => e.event === "sessions.changed");
    await client.waitFor(
      (e) =>
        e.event === "ipc" &&
        (e.payload as { channel: string }).channel === "session:progress",
    );
    // The agent stream is never sent twice.
    expect(
      client.inbox.filter(
        (e) =>
          e.event === "ipc" &&
          (e.payload as { channel: string }).channel === "agent:event:a1",
      ),
    ).toEqual([]);
    client.socket.destroy();
  });

  it("delegates platform calls to the attached UI and round-trips banners", async () => {
    const base = nodeHostPlatform();
    const baseNotify = vi.spyOn(base, "notify");
    const platform = uiHostPlatform(server.channel, base);
    const client = await connectClient(socketPath);
    await client.request("ui.state", { foreground: true });
    expect(platform.isForeground()).toBe(true);

    const onAction = vi.fn();
    const onClick = vi.fn();
    platform.notify({
      title: "Needs approval",
      body: "Bash",
      actions: ["Approve", "Deny"],
      onAction,
      onClick,
    });
    const request = await client.waitFor((e) => e.event === "platform.request");
    const payload = request.payload as { id: string; kind: string };
    expect(payload).toMatchObject({
      kind: "notify",
      title: "Needs approval",
      actions: ["Approve", "Deny"],
    });
    await client.request("ui.notification_action", {
      id: payload.id,
      action: 1,
    });
    expect(onAction).toHaveBeenCalledWith(1);
    expect(onClick).not.toHaveBeenCalled();
    expect(baseNotify).not.toHaveBeenCalled();

    await platform.openExternal("https://example.com");
    await client.waitFor(
      (e) =>
        (e.payload as { kind?: string } | undefined)?.kind === "open_external",
    );
    client.socket.destroy();
  });

  it("falls back to the headless platform with no UI attached", async () => {
    const base = nodeHostPlatform();
    const baseNotify = vi.spyOn(base, "notify");
    const baseFocus = vi.spyOn(base, "focusUi");
    const platform = uiHostPlatform(server.channel, base);

    platform.notify({ title: "t", body: "b" });
    platform.focusUi();
    expect(baseNotify).toHaveBeenCalledOnce();
    expect(baseFocus).toHaveBeenCalledOnce();
    expect(platform.isForeground()).toBe(false);
  });

  it("forgets focus when the UI goes away", async () => {
    const platform = uiHostPlatform(server.channel, nodeHostPlatform());
    const client = await connectClient(socketPath);
    await client.request("ui.state", { foreground: true });
    expect(platform.isForeground()).toBe(true);
    client.socket.destroy();
    await vi.waitFor(() => expect(server.channel.attached).toBe(false));
    expect(platform.isForeground()).toBe(false);
  });

  it("rejects malformed ui.* params", async () => {
    const client = await connectClient(socketPath);
    const res = await client.request("ui.notification_action", { id: 1 });
    expect(res.error).toMatchObject({ code: "bad_request" });
    client.socket.destroy();
  });
});
