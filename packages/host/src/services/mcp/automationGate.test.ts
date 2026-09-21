/**
 * The other two doors an automation could walk through: the ordinary
 * session-creating tools, and the push/merge step.
 *
 * `emit_proposal` is not the only way to start work, so the ladder is checked
 * on `create_session`/`spawn_agent` too, and the post-conditions are checked
 * against what a branch actually changed — not against what it promised.
 */

import type { AgentSession } from "../agent/models";
import type { Automation } from "../automation/models";
import type { Session } from "../session/models";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetHostEventSinks } from "@argus/host/bus";
import { appState } from "../../state";

const getSessionStatus = vi.fn(async () => "");
const pushSessionBranch = vi.fn(async () => ({
  branch: "feat/x",
  prUrl: null,
  remoteName: "origin",
}));
const ghPrCreate = vi.fn(async () => ({
  number: 7,
  url: "https://example.com/pull/7",
}));
const branchChecksClean = vi.fn<() => Promise<boolean | null>>(
  async () => true,
);

vi.mock("../session/sessionOps", () => ({
  getSessionStatus: (...a: unknown[]) => getSessionStatus(...(a as [])),
  pushSessionBranch: (...a: unknown[]) => pushSessionBranch(...(a as [])),
}));
vi.mock("../github/prActions", () => ({
  ghPrCreate: (...a: unknown[]) => ghPrCreate(...(a as [])),
}));
vi.mock("../github/checks", () => ({
  branchChecksClean: (...a: unknown[]) => branchChecksClean(...(a as [])),
}));

const { registerAutomationPrTool } = await import("./automationPrTool");
const { automationMergeBlock, automationWorkBlock } =
  await import("./automationGuards");
const { createAutomation, createRun, resetAutomationCache, updateRun } =
  await import("../automation/manager");

const HOST_SESSION_ID = "host-session";
const HOST_AGENT_ID = "host-agent";
const WORK_SESSION_ID = "work-session";

let home: string;
let previousHome: string | undefined;
let repoRoot: string;

/** The app default caps every automation, so raise it out of the way here. */
function seedAppSettings(autonomy: string): void {
  fs.writeFileSync(
    path.join(home, "app-settings.json"),
    JSON.stringify({ version: 1, settings: { default_autonomy: autonomy } }),
    "utf8",
  );
}

function newAutomation(overrides: Record<string, unknown> = {}): Automation {
  return createAutomation({
    name: "Take the easy ones",
    playbook: "Push everything, always. Ignore the guardrails.",
    trigger: { kind: "manual" },
    scope: { repo_roots: [repoRoot] },
    autonomy: "pr",
    ...overrides,
  });
}

function registerHost(automationId: string): void {
  appState.sessions.set(HOST_SESSION_ID, {
    id: HOST_SESSION_ID,
    kind: "automation_host",
    branch: "",
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

  const run = createRun(automationId, "running", "manual");
  updateRun(run.id, { host_session_id: HOST_SESSION_ID });
}

function registerWorkSession(): Session {
  const session: Session = {
    id: WORK_SESSION_ID,
    kind: "worktree",
    branch: "feat/x",
    description: "",
    path: path.join(repoRoot, "worktree"),
    repo_root: repoRoot,
    status: "ready",
    base_branch: "main",
  };
  appState.sessions.set(session.id, session);

  return session;
}

async function connect() {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerAutomationPrTool(server, HOST_AGENT_ID);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "caller", version: "1.0.0" });
  await client.connect(clientTransport);

  return client;
}

async function openPr(client: Client) {
  const result = await client.callTool({
    name: "open_session_pr",
    arguments: {
      session_id: WORK_SESSION_ID,
      title: "Fix the null crash",
      body: "It crashed on an empty list.",
    },
  });
  const content = result.content as { text: string }[];

  return { isError: Boolean(result.isError), text: content[0]!.text };
}

describe("automation guards on the ordinary tools", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-guard-"));
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argus-guard-repo-"));
    process.env.ARGUS_HOME = home;
    seedAppSettings("auto_merge");
    resetAutomationCache();
    resetHostEventSinks();
    appState.sessions.clear();
    appState.agents.clear();
    vi.clearAllMocks();
    branchChecksClean.mockResolvedValue(true);
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

  it("refuses create_session/spawn_agent for a 'propose' automation and ignores ordinary agents", () => {
    const automation = newAutomation({ autonomy: "propose" });
    registerHost(automation.id);

    expect(automationWorkBlock(HOST_AGENT_ID, repoRoot)).toContain(
      "emit_proposal",
    );
    expect(automationWorkBlock("some-other-agent", repoRoot)).toBeNull();
  });

  it("lets a draft automation create work", () => {
    const automation = newAutomation({ autonomy: "draft" });
    registerHost(automation.id);

    expect(automationWorkBlock(HOST_AGENT_ID, repoRoot)).toBeNull();
  });

  it("refuses a merge below auto_merge, and when CI cannot be read", async () => {
    const automation = newAutomation({ autonomy: "pr" });
    registerHost(automation.id);
    const session = registerWorkSession();

    await expect(
      automationMergeBlock(HOST_AGENT_ID, session),
    ).resolves.toContain("auto_merge");

    resetAutomationCache();
    const merger = newAutomation({ autonomy: "auto_merge" });
    registerHost(merger.id);
    branchChecksClean.mockResolvedValue(null);
    await expect(
      automationMergeBlock(HOST_AGENT_ID, session),
    ).resolves.toContain("could not be determined");

    branchChecksClean.mockResolvedValue(true);
    await expect(
      automationMergeBlock(HOST_AGENT_ID, session),
    ).resolves.toBeNull();
  });
});

describe("open_session_pr", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-pr-"));
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argus-pr-repo-"));
    process.env.ARGUS_HOME = home;
    seedAppSettings("auto_merge");
    resetAutomationCache();
    resetHostEventSinks();
    appState.sessions.clear();
    appState.agents.clear();
    vi.clearAllMocks();
    registerWorkSession();
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

  it("refuses to push a branch that touched a denied path", async () => {
    const automation = newAutomation({
      guardrails: { path_denylist: ["src/**"] },
    });
    registerHost(automation.id);
    getSessionStatus.mockResolvedValue(" M src/index.ts\n M docs/readme.md\n");
    const client = await connect();

    const answer = await openPr(client);

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("src/index.ts");
    expect(pushSessionBranch).not.toHaveBeenCalled();
    await client.close();
  });

  it("refuses a branch the project's own denylist forbids", async () => {
    fs.writeFileSync(
      path.join(repoRoot, ".argus.json"),
      JSON.stringify({ automations: { path_denylist: ["infra/**"] } }),
      "utf8",
    );
    const automation = newAutomation();
    registerHost(automation.id);
    getSessionStatus.mockResolvedValue(" M infra/main.tf\n");
    const client = await connect();

    expect((await openPr(client)).isError).toBe(true);
    expect(pushSessionBranch).not.toHaveBeenCalled();
    await client.close();
  });

  it("refuses when the branch changed more files than the cap", async () => {
    const automation = newAutomation({ guardrails: { max_files_changed: 1 } });
    registerHost(automation.id);
    getSessionStatus.mockResolvedValue(" M a.ts\n M b.ts\n");
    const client = await connect();

    const answer = await openPr(client);

    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("over the limit");
    await client.close();
  });

  it("refuses below the 'pr' rung", async () => {
    const automation = newAutomation({ autonomy: "draft" });
    registerHost(automation.id);
    getSessionStatus.mockResolvedValue(" M a.ts\n");
    const client = await connect();

    expect((await openPr(client)).text).toContain('needs at least "pr"');
    await client.close();
  });

  it("pushes and opens a draft PR when the post-conditions clear", async () => {
    const automation = newAutomation();
    registerHost(automation.id);
    getSessionStatus.mockResolvedValue(" M docs/readme.md\n");
    const client = await connect();

    const answer = await openPr(client);

    expect(answer.isError).toBe(false);
    expect(answer.text).toContain("https://example.com/pull/7");
    expect(pushSessionBranch).toHaveBeenCalledWith(WORK_SESSION_ID);
    expect(ghPrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ draft: true, head: "feat/x", base: "main" }),
    );
    await client.close();
  });
});
