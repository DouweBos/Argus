// @vitest-environment jsdom
import type { Transport } from "@argus/remote-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutomationsStore } from "./automations";
import { useConnectionStore } from "./connection";
import { resetHostStores } from "./hostSync";
import { inboxProposals, useProposalsStore } from "./proposals";

type Handler = (params: Record<string, unknown>) => unknown;

function fakeTransport(handlers: Record<string, Handler>) {
  const calls: [string, Record<string, unknown>][] = [];
  const transport = {
    request: vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push([method, params]);
      const handler = handlers[method];
      if (!handler) {
        throw Object.assign(new Error(`no ${method}`), { code: "not_found" });
      }

      return handler(params);
    }),
  };
  useConnectionStore.setState({
    transport: transport as unknown as Transport,
    connection: "ready",
  });

  return calls;
}

function proposal(id: string, status = "pending") {
  return { id, status, title: id, start_stage: null, start_error: null };
}

afterEach(() => resetHostStores());

describe("proposals store", () => {
  it("keeps pending apart from the recent ones it adds", async () => {
    fakeTransport({
      "proposals.list": (p) => ({
        proposals:
          p.status === "pending"
            ? [proposal("p1")]
            : [proposal("p1"), proposal("p2", "withdrawn")],
      }),
    });
    await useProposalsStore.getState().refresh();
    const { pending, recent } = useProposalsStore.getState();
    expect(inboxProposals(pending, recent).map((p) => p.id)).toEqual([
      "p1",
      "p2",
    ]);
    expect(useProposalsStore.getState().load).toEqual({
      loaded: true,
      error: null,
    });
  });

  it("hands back the agent a start made, and lands the decision", async () => {
    const calls = fakeTransport({
      "proposals.list": () => ({ proposals: [] }),
      "proposals.accept": () => ({
        proposal: proposal("p1", "accepted"),
        session_id: "s1",
        agent_id: "a1",
      }),
    });
    useProposalsStore.setState({ pending: [proposal("p1")] as never });
    const started = await useProposalsStore
      .getState()
      .accept("p1", "  use the new API ");
    expect(started).toEqual({ agentId: "a1", sessionId: "s1" });
    expect(calls[0]).toEqual([
      "proposals.accept",
      { proposal_id: "p1", note: "use the new API" },
    ]);
    expect(useProposalsStore.getState().pending).toEqual([]);
  });

  it("keeps a refused start on the card, not the banner", async () => {
    fakeTransport({
      "proposals.list": () => ({ proposals: [] }),
      "proposals.accept": () => {
        throw new Error("Already starting.");
      },
    });
    expect(await useProposalsStore.getState().accept("p1")).toBeNull();
    expect(useProposalsStore.getState().requestErrors.p1).toBe(
      "Already starting.",
    );
    expect(useProposalsStore.getState().error).toBeNull();
  });
});

describe("automations store", () => {
  it("sends a quick run with the host's guardrails and the model picked", async () => {
    const calls = fakeTransport({
      "automations.run_scratch": () => ({
        run: { id: "r1", is_quick: true, automation_id: "x" },
      }),
      "automations.list": () => ({ automations: [] }),
      "automations.runs": () => ({ runs: [] }),
    });
    await useAutomationsStore.getState().runScratch({
      name: "Quick run",
      playbook: "Say hi",
      repo_roots: [],
      model: "claude-haiku-4-5",
    });
    const [method, params] = calls[0];
    expect(method).toBe("automations.run_scratch");
    expect(params).toMatchObject({
      model: "claude-haiku-4-5",
      source_ids: [],
      guardrails: { confidence_threshold: 0.8 },
    });
    expect(useAutomationsStore.getState().quickRuns?.map((r) => r.id)).toEqual(
      ["r1"],
    );
  });

  it("reports a failed pause on the banner", async () => {
    fakeTransport({});
    await useAutomationsStore.getState().setEnabled("a1", false);
    expect(useAutomationsStore.getState().error).toContain(
      "Couldn't pause it",
    );
  });
});
