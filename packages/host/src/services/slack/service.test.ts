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
const BOT2 = "xoxb-other-bot";

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
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = String(url).split("/").pop();
        const other = String(
          (init?.headers as Record<string, string>).Authorization,
        ).includes(BOT2);
        const body =
          method === "auth.test"
            ? {
                ok: true,
                team_id: other ? "T2" : "T1",
                team: other ? "Globex" : "Acme",
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
    const overview = await connectSlack(BOT, APP);
    const [acme] = overview.workspaces;

    expect(acme).toMatchObject({
      team_id: "T1",
      configured: true,
      workspace: "Acme",
      owner: null,
    });
    expect(acme?.claim_code).toMatch(/^\d{6}$/);
    expect(remoteSlackStatus().status.claim_code).toBeNull();

    const onDisk = fs.readFileSync(path.join(home, "slack.json"), "utf8");
    expect(onDisk).not.toContain(BOT);
    expect(onDisk).not.toContain(APP);
    expect(fs.existsSync(path.join(home, "app-settings.json"))).toBe(false);

    expect(disconnectSlack("T1").workspaces[0]?.configured).toBe(false);
    expect(
      fs.readFileSync(path.join(home, "slack.json"), "utf8"),
    ).not.toContain("sealed");
  });

  it("keeps each workspace's own owner and projects", async () => {
    const {
      connectSlack,
      setDefaultProject,
      disconnectSlack,
      removeWorkspace,
    } = await import("./service");
    await connectSlack(BOT, APP);
    await connectSlack(BOT2, APP);
    setDefaultProject("T2", "/repo/globex");
    const overview = setDefaultProject("T1", "/repo/acme");

    expect(
      overview.workspaces.map((w) => [w.workspace, w.default_project]),
    ).toEqual([
      ["Acme", "/repo/acme"],
      ["Globex", "/repo/globex"],
    ]);
    expect(disconnectSlack("T1").workspaces.map((w) => w.configured)).toEqual([
      false,
      true,
    ]);
    // Reconnecting a known workspace keeps its settings.
    const back = await connectSlack(BOT, APP);
    expect(back.workspaces[0]?.default_project).toBe("/repo/acme");

    expect(removeWorkspace("T1").workspaces.map((w) => w.team_id)).toEqual([
      "T2",
    ]);
    expect(() => setDefaultProject("T1", null)).toThrow();
  });

  it("moves a single-workspace file and its threads to the workspace", async () => {
    fs.writeFileSync(
      path.join(home, "slack.json"),
      JSON.stringify({
        identity: {
          teamId: "T9",
          workspace: "Old",
          botUserId: "UB",
          botName: "argus",
        },
        config: { defaultProject: "/repo/old", owner: null },
      }),
    );
    fs.writeFileSync(
      path.join(home, "slack-threads.json"),
      JSON.stringify({ threads: [] }),
    );
    const { slackOverview } = await import("./service");

    expect(slackOverview().workspaces).toMatchObject([
      { team_id: "T9", workspace: "Old", default_project: "/repo/old" },
    ]);
    expect(fs.existsSync(path.join(home, "slack-threads-T9.json"))).toBe(true);
    expect(fs.existsSync(path.join(home, "slack-threads.json"))).toBe(false);
  });

  it("won't keep tokens where there is no secure storage", async () => {
    setHostPlatform(nodeHostPlatform());
    const { connectSlack } = await import("./service");
    await expect(connectSlack(BOT, APP)).rejects.toContain("no secure storage");
  });
});
