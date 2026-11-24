import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nodeHostPlatform, setHostPlatform } from "../../platform";

vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));
// The host's agent and session stack isn't what this tests.
vi.mock("../agent/agentService", () => ({ respondToPermission: vi.fn() }));
vi.mock("./wiring", () => ({ hostDeps: () => ({ identity: () => null }) }));

const BOT = "xoxb-secret-bot";
const APP = "xapp-secret-app";

class FakeWebSocket {
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  send(): void {}
  close(): void {}
}

describe("slack service", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-slack-home-"));
    vi.stubEnv("ARGUS_HOME", home);
    setHostPlatform(
      nodeHostPlatform({
        secretStorage: {
          isAvailable: () => true,
          encrypt: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
          decrypt: (b) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString(),
        },
      }),
    );
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const method = String(url).split("/").pop();
        const body =
          method === "auth.test"
            ? {
                ok: true,
                team_id: "T1",
                team: "Acme",
                user_id: "UBOT",
                user: "argus",
              }
            : { ok: true, url: "wss://slack.test/socket" };

        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
  });

  afterEach(async () => {
    const { stopSlack } = await import("./service");
    stopSlack();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    setHostPlatform(nodeHostPlatform());
  });

  it("refuses tokens of the wrong kind before calling Slack", async () => {
    const { connectSlack } = await import("./service");
    await expect(connectSlack(APP, BOT)).rejects.toContain("xoxb-");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("seals both tokens and keeps the claim code off paired devices", async () => {
    const { connectSlack, remoteSlackStatus, disconnectSlack } =
      await import("./service");
    const status = await connectSlack(BOT, APP);

    expect(status).toMatchObject({
      configured: true,
      workspace: "Acme",
      owner: null,
    });
    expect(status.claim_code).toMatch(/^\d{6}$/);
    expect(remoteSlackStatus().claim_code).toBeNull();

    const onDisk = fs.readFileSync(path.join(home, "slack.json"), "utf8");
    expect(onDisk).not.toContain(BOT);
    expect(onDisk).not.toContain(APP);
    expect(fs.existsSync(path.join(home, "app-settings.json"))).toBe(false);

    expect(disconnectSlack().configured).toBe(false);
    expect(
      fs.readFileSync(path.join(home, "slack.json"), "utf8"),
    ).not.toContain("sealed");
  });

  it("won't keep tokens where there is no secure storage", async () => {
    setHostPlatform(nodeHostPlatform());
    const { connectSlack } = await import("./service");
    await expect(connectSlack(BOT, APP)).rejects.toContain("no secure storage");
  });
});
