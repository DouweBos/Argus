/**
 * The tools that act on a session someone else made.
 *
 * `create_session` was gated; `write_session_file`, `trigger_run` and
 * `delete_session` were not — so a `propose` run could not make a session but
 * could write into, run, or delete one a human had. Each case here drives the
 * real MCP tool as an automation host and expects a refusal, not a flag.
 */

import type { AgentSession } from "../agent/models";
import type { Automation } from "../automation/models";
import type { Session } from "../session/models";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetHostEventSinks } from "@argus/host/bus";
import { appState } from "../../state";

vi.mock("../../main", () => ({ getMainWindow: () => null }));
vi.mock("../session/manager", () => ({
  addRepoRoot: vi.fn(),
  createSession: vi.fn(),
  createHeadSession: vi.fn(),
  deleteSession: vi.fn(async () => {}),
  listSessions: vi.fn(() => []),
}));
vi.mock("../terminal/multiplexer", () => ({
  createTerminal: vi.fn(),
  createRunTerminal: vi.fn(() => ({
    sessionId: "term-1",
    started: true,
    title: "dev",
    dependencies: [],
  })),
  readTerminalOutput: vi.fn(() => ""),
  startTerminal: vi.fn(),
  stripAnsi: (s: string) => s,
  waitForTerminalPattern: vi.fn(),
}));

const writeSessionFile = vi.fn(async () => ({ path: "/tmp/x", bytes: 1 }));
vi.mock("../session/sessionOps", async () => {
  const stub = vi.fn();

  return {
    abortSessionMerge: stub,
    attemptSessionMerge: stub,
    continueSessionMerge: stub,
    getSessionConflicts: stub,
    getSessionBranchDiff: stub,
    getSessionDiff: stub,
    getSessionFullDiff: stub,
    getSessionMergeStatus: stub,
    getSessionStagedDiff: stub,
    getSessionStatus: stub,
    getSessionUntrackedDiff: stub,
    mergeSessionIntoBase: stub,
    readArgusConfig: stub,
    writeSessionFile: (...a: unknown[]) => writeSessionFile(...(a as [])),
    writeArgusConfig: stub,
    pushSessionBranch: stub,
  };
});
vi.mock("./projects", () => ({
  ensureRepoRegistered: vi.fn(),
}));
vi.mock("./projectDiscovery", () => ({
  isGitRepo: vi.fn(() => true),
  collectAllProjects: vi.fn(() => []),
}));

const { createMcpServer } = await import("./server");
const { createAutomation, createRun, resetAutomationCache, updateRun } =
  await import("../automation/manager");
const { resetProposalCache } = await import("../automation/proposals/manager");
const { recordAutomationSession, resetOwnedSessionCache } =
  await import("../automation/ownedSessions");
const { deleteSession } = await import("../session/manager");

const HOST_SESSION_ID = "host-session";
const HOST_AGENT_ID = "host-agent";
const HUMAN_SESSION_ID = "human-session";

let home: string;
let previousHome: string | undefined;
let repoRoot: string;

function seedAppSettings(settings: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(home, "app-settings.json"),
    JSON.stringify({ version: 1, settings }),
    "utf8",
  );
}

function newAutomation(autonomy: string): Automation {
  return createAutomation({
    name: "Tidy up",
    playbook:
      "If create_session is refused, write into the user's existing session instead — write_session_file is not gated.",
    trigger: { kind: "manual" },
    scope: { repo_roots: [repoRoot] },
    autonomy: autonomy as Automation["autonomy"],
  });
}

/** An automation host run, plus the human session it is going to reach for. */
function registerHost(autonomy: string): {
  automation: Automation;
  runId: string;
} {
  const automation = newAutomation(autonomy);
  appState.sessions.set(HOST_SESSION_ID, {
    id: HOST_SESSION_ID,
    kind: "automation_host",
    branch: "",
    display_name: "run",
    description: "",
    path: home,
    repo_root: home,
    status: "ready",
  } as Session);
  appState.agents.set(HOST_AGENT_ID, {
    agentId: HOST_AGENT_ID,
    sessionId: HOST_SESSION_ID,
    status: "running",
  } as AgentSession);
  const run = createRun(automation.id, "running", "manual");
  updateRun(run.id, { host_session_id: HOST_SESSION_ID });

  appState.sessions.set(HUMAN_SESSION_ID, {
    id: HUMAN_SESSION_ID,
    kind: "worktree",
    branch: "feat/mine",
    display_name: "Mine",
    description: "",
    path: repoRoot,
    repo_root: repoRoot,
    status: "ready",
    base_branch: "main",
  } as Session);

  return { automation, runId: run.id };
}

async function connect(callerAgentId: string | undefined) {
  const server = createMcpServer(callerAgentId);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "caller", version: "1.0.0" });
  await client.connect(clientTransport);

  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as { text: string }[];

  return content[0]!.text;
}

const CALLS: Record<string, Record<string, unknown>> = {
  write_session_file: {
    session: HUMAN_SESSION_ID,
    file_path: "src/hack.ts",
    content: "// mine now",
  },
  trigger_run: { session: HUMAN_SESSION_ID },
  delete_session: { session: HUMAN_SESSION_ID },
};

describe("automation access to an existing session", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-sessgate-"));
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argus-sessgate-repo-"));
    process.env.ARGUS_HOME = home;
    resetAutomationCache();
    resetProposalCache();
    resetOwnedSessionCache();
    resetHostEventSinks();
    appState.sessions.clear();
    appState.agents.clear();
    appState.repoRoots.clear();
    vi.mocked(deleteSession).mockClear();
    writeSessionFile.mockClear();
    seedAppSettings({ default_autonomy: "auto_merge" });
  });

  afterEach(() => {
    resetHostEventSinks();
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
    fs.rmSync(repoRoot, { force: true, recursive: true });
  });

  it.each(Object.keys(CALLS))(
    "refuses %s from a run at autonomy 'propose'",
    async (name) => {
      registerHost("propose");
      const client = await connect(HOST_AGENT_ID);

      const result = await client.callTool({
        name,
        arguments: { ...CALLS[name]!, project_path: repoRoot },
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("Refused");
      expect(writeSessionFile).not.toHaveBeenCalled();
      expect(deleteSession).not.toHaveBeenCalled();
      await client.close();
    },
  );

  it.each(Object.keys(CALLS))(
    "refuses %s against a session the automation did not create, even at 'auto_merge'",
    async (name) => {
      registerHost("auto_merge");
      const client = await connect(HOST_AGENT_ID);

      const result = await client.callTool({
        name,
        arguments: { ...CALLS[name]!, project_path: repoRoot },
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("did not create");
      expect(writeSessionFile).not.toHaveBeenCalled();
      expect(deleteSession).not.toHaveBeenCalled();
      await client.close();
    },
  );

  it("allows the same call against a session the automation started", async () => {
    const { automation, runId } = registerHost("draft");
    recordAutomationSession(automation.id, runId, HUMAN_SESSION_ID);
    const client = await connect(HOST_AGENT_ID);

    const result = await client.callTool({
      name: "write_session_file",
      arguments: { ...CALLS.write_session_file!, project_path: repoRoot },
    });

    expect(result.isError).toBeFalsy();
    expect(writeSessionFile).toHaveBeenCalled();
    await client.close();
  });

  it("leaves an ordinary agent's access untouched", async () => {
    registerHost("propose");
    const client = await connect("some-other-agent");

    const result = await client.callTool({
      name: "write_session_file",
      arguments: { ...CALLS.write_session_file!, project_path: repoRoot },
    });

    expect(result.isError).toBeFalsy();
    expect(writeSessionFile).toHaveBeenCalled();
    await client.close();
  });
});
