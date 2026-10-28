import type { GatewayContext } from "./capabilities";
import type { Session } from "../session/models";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentPendingPermissions: new Map(),
    sessions: new Map(),
  },
}));
vi.mock("../mcp/projectDiscovery", () => ({
  collectAllProjects: vi.fn(() => [{ path: "/repo" }]),
}));
vi.mock("../agent/chatHistory", () => ({
  loadHistoryIndex: vi.fn(() => []),
  loadConversation: vi.fn((_root: string, id: string) =>
    id === "h1"
      ? {
          title: "Triage",
          model: null,
          messages: [{ id: "m1", role: "user", textBlocks: ["hi"] }],
        }
      : null,
  ),
}));

const { appState } = await import("../../state");
const { dispatch } = await import("./capabilities");

const ctx: GatewayContext = {
  device: {
    device_id: "dev-1",
    label: "Mac",
    dev_static_pub: "",
    capabilities: ["monitor"],
    created_at: 0,
    last_seen: null,
  },
  connectionId: "conn-1",
  outstandingPermissions: new Set(),
};

const runSession = {
  id: "s-run",
  kind: "automation_host",
  branch: "",
  path: "/home/.argus/automation-runs/a/r",
  repo_root: "/home/.argus/automation-runs/a/r",
  status: "ready",
} as Session;

describe("saved chats outside a project", () => {
  beforeEach(() => {
    appState.sessions.clear();
  });

  it("reads an automation run's saved chat from its own folder", async () => {
    appState.sessions.set(runSession.id, runSession);
    const page = (await dispatch(
      "agents.stopped_transcript",
      { repo_root: runSession.repo_root, history_id: "h1" },
      ctx,
    )) as { messages: { id: string }[] };

    expect(page.messages.map((m) => m.id)).toEqual(["m1"]);
  });

  it("still refuses a folder no project or session owns", async () => {
    await expect(
      dispatch(
        "agents.stopped_transcript",
        { repo_root: "/elsewhere", history_id: "h1" },
        ctx,
      ),
    ).rejects.toThrow("unknown repo_root");
  });
});
