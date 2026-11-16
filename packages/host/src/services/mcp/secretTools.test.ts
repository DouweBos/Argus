import type { AgentSession } from "../agent/models";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addHostEventSink } from "@argus/host/bus";
import { appState } from "../../state";

const conversation = { messages: [] as unknown[] };
const purpose = { value: "user" };

vi.mock("../agent/conversation/folded", () => ({
  conversationOf: () => conversation,
}));
vi.mock("./automationCaller", () => ({
  worktreePurposeForCaller: () => purpose.value,
}));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));
vi.mock("../terminal/multiplexer", () => ({
  resolveRunCommand: (_s: string, title?: string) => {
    if (title !== "Dev") {
      throw "No run command with title";
    }

    return { title: "Dev" };
  },
}));

const { capture } = await import("../telemetry/telemetry");
const { registerSecretTools, DECLINED_RESULT } = await import("./secretTools");
const { answerSecretRequest, resetSecretRequestsForTests } =
  await import("../secretRequest/requests");
const { runSecretEnv, resetVaultForTests, setSecretsRootForTests } =
  await import("../secretRequest/vault");

const AGENT = "agent-1";
let root: string;

function call(id: string, name = "mcp__argus__request_secret") {
  return { id, name, input: {} };
}

async function connect(caller: string | null = AGENT) {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerSecretTools(server, caller);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "caller", version: "1.0.0" });
  await client.connect(clientTransport);

  return client;
}

function textOf(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0]!.text;
}

/** The permission events the card rides on, minus the value. */
function recordEvents() {
  const events: { channel: string; payload: unknown }[] = [];
  const off = addHostEventSink((channel, args) => {
    events.push({ channel, payload: args[0] });
  });

  return { events, off };
}

describe("request_secret", () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "secret-test-"));
    setSecretsRootForTests(path.join(root, "vault"));
    appState.agents.clear();
    appState.agentPendingPermissions.clear();
    appState.agents.set(AGENT, {
      agentId: AGENT,
      sessionId: "s-1",
    } as AgentSession);
    conversation.messages = [{ toolCalls: [call("tu-1")] }];
    purpose.value = "user";
    vi.mocked(capture).mockClear();
  });

  afterEach(() => {
    resetSecretRequestsForTests();
    resetVaultForTests();
    setSecretsRootForTests(null);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("is always loaded", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "request_secret")?._meta).toEqual({
      "anthropic/alwaysLoad": true,
    });
  });

  it("writes the answer to an owner-only file and returns only its path", async () => {
    const { events, off } = recordEvents();
    const client = await connect();
    const pending = client.callTool({
      name: "request_secret",
      arguments: { label: "adb pairing code", reason: "Pair the Pixel" },
      _meta: { "claudecode/toolUseId": "tu-1" },
    });
    await vi.waitFor(() =>
      expect(appState.agentPendingPermissions.get(AGENT)?.has("tu-1")).toBe(
        true,
      ),
    );
    answerSecretRequest(AGENT, "tu-1", "482913");
    const text = textOf(await pending);
    off();

    expect(text).not.toContain("482913");
    const { path: file } = JSON.parse(text) as { path: string };
    expect(fs.readFileSync(file, "utf8")).toBe("482913");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    expect(JSON.stringify(events)).not.toContain("482913");
    expect(events.map((e) => e.channel)).toEqual([
      `agent:permission:${AGENT}`,
      `agent:permission-resolved:${AGENT}`,
    ]);
    expect(capture).toHaveBeenCalledWith("secret_requested", {
      delivery: "file",
      outcome: "provided",
    });
    expect(appState.agentPendingPermissions.get(AGENT)?.has("tu-1")).toBe(
      false,
    );
  });

  it("finds the call in the transcript when the runner sends no id", async () => {
    const client = await connect();
    const pending = client.callTool({
      name: "request_secret",
      arguments: { label: "token", reason: "r" },
    });
    await vi.waitFor(() =>
      expect(appState.agentPendingPermissions.get(AGENT)?.has("tu-1")).toBe(
        true,
      ),
    );
    answerSecretRequest(AGENT, "tu-1", null);
    const result = await pending;
    expect(textOf(result)).toBe(DECLINED_RESULT);
    expect(capture).toHaveBeenCalledWith("secret_requested", {
      delivery: "file",
      outcome: "declined",
    });
  });

  it("hands an env delivery to the run command, not to the agent", async () => {
    const client = await connect();
    const pending = client.callTool({
      name: "request_secret",
      arguments: {
        label: "Expo token",
        reason: "r",
        delivery: "env",
        run_command: "Dev",
        env_var: "EXPO_TOKEN",
      },
      _meta: { "claudecode/toolUseId": "tu-1" },
    });
    await vi.waitFor(() =>
      expect(appState.agentPendingPermissions.get(AGENT)?.has("tu-1")).toBe(
        true,
      ),
    );
    answerSecretRequest(AGENT, "tu-1", "s3cret");
    expect(textOf(await pending)).not.toContain("s3cret");
    expect(runSecretEnv("s-1", "Dev")).toEqual({ EXPO_TOKEN: "s3cret" });
  });

  it("refuses a bad env delivery before showing a card", async () => {
    const client = await connect();
    const bad = await client.callTool({
      name: "request_secret",
      arguments: {
        label: "t",
        reason: "r",
        delivery: "env",
        run_command: "Nope",
        env_var: "TOKEN",
      },
    });
    expect(bad.isError).toBe(true);
    expect(appState.agentPendingPermissions.size).toBe(0);
  });

  it("refuses automation runs and unknown callers", async () => {
    purpose.value = "automation";
    expect(
      (
        await (
          await connect()
        ).callTool({
          name: "request_secret",
          arguments: { label: "t", reason: "r" },
        })
      ).isError,
    ).toBe(true);
    purpose.value = "user";
    expect(
      (
        await (
          await connect(null)
        ).callTool({
          name: "request_secret",
          arguments: { label: "t", reason: "r" },
        })
      ).isError,
    ).toBe(true);
  });

  it("cancels when the agent exits", async () => {
    const { events, off } = recordEvents();
    const client = await connect();
    const pending = client.callTool({
      name: "request_secret",
      arguments: { label: "t", reason: "r" },
      _meta: { "claudecode/toolUseId": "tu-1" },
    });
    await vi.waitFor(() =>
      expect(appState.agentPendingPermissions.get(AGENT)?.has("tu-1")).toBe(
        true,
      ),
    );
    const { emitHostEvent } = await import("@argus/host/bus");
    emitHostEvent(`agent:exit:${AGENT}`, 0);
    expect((await pending).isError).toBe(true);
    off();
    expect(events.map((e) => e.channel)).toContain(
      `agent:permission-cancel:${AGENT}`,
    );
  });
});
