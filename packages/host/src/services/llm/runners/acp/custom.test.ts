import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CustomAcpRunner } from "./custom";

vi.mock("@argus/host/platform", () => ({
  hostPlatform: () => ({ appVersion: () => "0.0.0-test" }),
}));

// Answers the ACP handshake and replies with the env var it was given.
const STUB = `
const rl = require("node:readline").createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\\n");
rl.on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") {
    send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  } else if (m.method === "session/new") {
    send({ id: m.id, result: { sessionId: "s-1" } });
  } else if (m.method === "session/prompt") {
    send({ method: "session/update", params: { sessionId: "s-1", update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: process.argv[2] + ":" + process.env.STUB_GREETING },
    } } });
    send({ id: m.id, result: { stopReason: "end_turn" } });
  } else if (m.id !== undefined) {
    send({ id: m.id, result: {} });
  }
});
`;

function runner(command: string, args: string[]) {
  return new CustomAcpRunner(
    {
      id: "custom:stub",
      displayName: "Stub",
      baseRunnerId: "acp",
      env: { STUB_GREETING: "hello" },
      models: [{ id: "stub-1", displayName: "Stub One" }],
      defaultModel: "stub-1",
    },
    { command, args },
  );
}

describe("custom ACP runner", () => {
  let dir: string;
  let script: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-acp-stub-"));
    script = path.join(dir, "stub.cjs");
    fs.writeFileSync(script, STUB);
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("is custom, ACP-based and offers its own models", () => {
    const r = runner(process.execPath, [script]);

    expect(r.isCustom).toBe(true);
    expect(r.baseRunnerId).toBe("acp");
    expect(r.models()).toEqual([{ value: "stub-1", displayName: "Stub One" }]);
    expect(r.defaultModel()).toBe("stub-1");
  });

  it("starts the configured command with its args and env", async () => {
    const answer = await runner(process.execPath, [script, "argv"]).oneShot({
      prompt: "hi",
      source: "test",
      timeoutMs: 10_000,
    });

    expect(answer).toBe("argv:hello");
  });

  it("explains a missing command with the default install hint", async () => {
    const pre = await runner("argus-no-such-acp-agent", []).preflight();

    expect(pre.ok).toBe(false);
    expect(pre.ok ? "" : pre.reason).toContain(
      "`argus-no-such-acp-agent` is on your PATH",
    );
  });
});
