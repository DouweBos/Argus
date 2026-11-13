import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hostLogFiles,
  safeSettings,
  snapshotLogs,
  triageBrief,
} from "./context";

let home: string;
let previousHome: string | undefined;

describe("triage context", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-triage-"));
    process.env.ARGUS_HOME = home;
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("keeps behaviour settings and drops secrets, paths and names", () => {
    const safe = safeSettings({
      remote_provider: "cloudflare",
      remote_tunnel_mode: "token",
      remote_tunnel_token: "secret-token",
      remote_public_url: "https://me.example.com",
      worktrees_base_dir: "/Users/someone/wt",
      huddle_display_name: "Someone",
      default_llm: { runner: "claude-code", model: "opus" },
      mcp_servers: { a: {}, b: {} },
    });

    expect(safe).toMatchObject({
      remote_provider: "cloudflare",
      remote_tunnel_mode: "token",
      remote_tunnel_token_set: true,
      remote_public_url_set: true,
      default_runner: "claude-code",
      mcp_server_count: 2,
    });
    const text = JSON.stringify(safe);
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("example.com");
    expect(text).not.toContain("/Users/someone");
    expect(text).not.toContain("Someone");
  });

  it("snapshots the tail of current logs into the pad and lists rotated ones", () => {
    const logs = path.join(home, "logs");
    fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(
      path.join(logs, "main.log"),
      "x".repeat(300 * 1024) + "END",
    );
    fs.writeFileSync(path.join(logs, "main.log.1"), "old");
    const pad = path.join(home, "pad");
    fs.mkdirSync(pad);

    const files = hostLogFiles();
    const snapshots = snapshotLogs(pad, files);

    expect(files).toHaveLength(2);
    expect(snapshots).toEqual([path.join("logs", "main.log")]);
    const copy = fs.readFileSync(path.join(pad, "logs", "main.log"), "utf8");
    expect(copy).toHaveLength(256 * 1024);
    expect(copy.endsWith("END")).toBe(true);
  });

  it("writes the problem, version and log locations into the brief", () => {
    const brief = triageBrief(
      {
        message: "Tunnel exited with code 1",
        level: "error",
        source: "remote",
      },
      { files: ["/x/logs/main.log"], snapshots: ["logs/main.log"] },
    );

    expect(brief).toContain("Tunnel exited with code 1");
    expect(brief).toContain("- Level: error");
    expect(brief).toContain("Argus version:");
    expect(brief).toContain("github.com/DouweBos/Argus/tree/");
    expect(brief).toContain("- logs/main.log");
    expect(brief).toContain("- /x/logs/main.log");
  });
});
