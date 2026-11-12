import type { AgentSession } from "../../../agent/models";
import { afterEach, describe, expect, it } from "vitest";
import { appState } from "../../../../state";
import { collectAgents, recordStatus, resetCollected } from "./collect";

function addAgent(status: AgentSession["status"]): void {
  appState.agents.set("a1", {
    agentId: "a1",
    sessionId: "s1",
    status,
    createdAt: 1_000,
    inflightPrompts: status === "running" ? 1 : 0,
  } as AgentSession);
}

describe("collectAgents", () => {
  afterEach(() => {
    appState.agents.delete("a1");
    appState.agentPendingPermissions.delete("a1");
    resetCollected();
  });

  it("shows a running agent as working", () => {
    addAgent("running");

    expect(collectAgents(5_000)).toMatchObject([
      { id: "a1", state: "working", startedAt: 1_000, prompt: null },
    ]);
  });

  it("offers Approve/Deny for a pending permission prompt", () => {
    addAgent("requires_action");
    appState.agentPendingPermissions.set(
      "a1",
      new Map([
        [
          "t1",
          {
            request_id: "r1",
            tool_use_id: "t1",
            tool_name: "Bash",
            tool_input: { command: "rm -rf build" },
          },
        ],
      ]),
    );

    expect(collectAgents(5_000)).toMatchObject([
      {
        state: "needsYou",
        prompt: { toolUseId: "t1", summary: "Bash rm -rf build" },
      },
    ]);
  });

  it("keeps a finished agent as an outcome, failed on an error", () => {
    addAgent("running");
    collectAgents(5_000);
    appState.agents.get("a1")!.status = "error";
    appState.agents.get("a1")!.inflightPrompts = 0;
    recordStatus("a1", "error", 6_000);
    appState.agents.delete("a1");

    expect(collectAgents(7_000)).toMatchObject([
      { id: "a1", state: "failed", endedAt: 6_000 },
    ]);
  });

  it("ignores an idle agent that never worked", () => {
    addAgent("idle");

    expect(collectAgents(5_000)).toEqual([]);
  });
});
