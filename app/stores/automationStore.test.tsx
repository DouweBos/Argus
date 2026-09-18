// @vitest-environment jsdom
/**
 * The automations screens never poll: the host pushes the whole list on
 * `automations:changed` and one run at a time on `automation_run:changed`.
 */

import type { Automation, AutomationRun } from "../lib/types";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GUARDRAILS } from "../lib/automations";

type Listener = (payload: unknown, hostId: string) => void;

const listeners = new Map<string, Set<Listener>>();

function emit(event: string, payload: unknown): void {
  for (const listener of listeners.get(event) ?? []) {
    listener(payload, "local");
  }
}

vi.mock("../lib/transport", () => ({
  subscribe: (event: string, cb: Listener) => {
    const set = listeners.get(event) ?? new Set<Listener>();
    set.add(cb);
    listeners.set(event, set);

    return () => set.delete(cb);
  },
}));

const listAutomations = vi.fn<() => Promise<Automation[]>>();
const listAutomationRuns = vi.fn<() => Promise<AutomationRun[]>>();

vi.mock("../lib/ipc", () => ({
  listAutomations: () => listAutomations(),
  listAutomationRuns: () => listAutomationRuns(),
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
  setAutomationEnabled: vi.fn(),
  runAutomationNow: vi.fn(),
  cancelAutomationRun: vi.fn(),
  getAutomationRun: vi.fn(),
}));

vi.mock("../lib/routeHooks", () => ({ useRouteHostId: () => "local" }));

const {
  getAutomationState,
  setAutomationState,
  useAutomationsSync,
  useHasActiveRun,
} = await import("./automationStore");

function automation(id: string, name: string): Automation {
  return {
    id,
    name,
    description: "",
    enabled: true,
    autonomy: null,
    guardrails: DEFAULT_GUARDRAILS,
    playbook: "do the thing",
    model: null,
    template_id: null,
    trigger: { kind: "manual" },
    scope: { repo_roots: [] },
    created_at: 0,
    updated_at: 0,
    last_run_at: null,
    next_run_at: null,
  };
}

function run(id: string, status: AutomationRun["status"]): AutomationRun {
  return {
    id,
    automation_id: "a-1",
    status,
    trigger_reason: "manual",
    started_at: 1_000,
    finished_at: status === "running" ? null : 2_000,
    host_session_id: null,
    host_agent_id: null,
    cost_usd: null,
    report_markdown: null,
    error: null,
  };
}

describe("automation store", () => {
  beforeEach(() => {
    listeners.clear();
    listAutomations.mockReset();
    listAutomationRuns.mockReset();
    listAutomations.mockResolvedValue([]);
    listAutomationRuns.mockResolvedValue([]);
    setAutomationState({
      automations: [],
      runs: [],
      loading: false,
      error: null,
    });
  });

  it("loads the list once and then listens", async () => {
    listAutomations.mockResolvedValue([automation("a-1", "Standup digest")]);
    renderHook(() => useAutomationsSync());

    await waitFor(() =>
      expect(getAutomationState().automations).toHaveLength(1),
    );
    expect(listAutomations).toHaveBeenCalledTimes(1);
  });

  it("replaces the list from automations:changed", async () => {
    renderHook(() => useAutomationsSync());
    await waitFor(() => expect(listAutomations).toHaveBeenCalled());

    act(() => {
      emit("automations:changed", [
        automation("a-1", "Standup digest"),
        automation("a-2", "PR shepherd"),
      ]);
    });
    expect(getAutomationState().automations.map((a) => a.name)).toEqual([
      "Standup digest",
      "PR shepherd",
    ]);

    act(() => {
      emit("automations:changed", [automation("a-2", "PR shepherd")]);
    });
    expect(getAutomationState().automations).toHaveLength(1);
  });

  it("follows one run's status through automation_run:changed", async () => {
    renderHook(() => useAutomationsSync());
    await waitFor(() => expect(listAutomationRuns).toHaveBeenCalled());

    act(() => emit("automation_run:changed", run("r-1", "running")));
    expect(getAutomationState().runs).toHaveLength(1);
    expect(getAutomationState().runs[0].status).toBe("running");

    act(() => emit("automation_run:changed", run("r-1", "succeeded")));
    expect(getAutomationState().runs).toHaveLength(1);
    expect(getAutomationState().runs[0].status).toBe("succeeded");
  });

  it("refetches after a bulk delete rather than guessing", async () => {
    renderHook(() => useAutomationsSync());
    await waitFor(() => expect(listAutomationRuns).toHaveBeenCalledTimes(1));

    act(() => emit("automation_run:changed", run("r-1", "succeeded")));
    listAutomationRuns.mockResolvedValue([]);
    act(() => emit("automation_run:changed", null));

    await waitFor(() => expect(getAutomationState().runs).toHaveLength(0));
  });

  it("reports an in-flight run so a second trigger is not offered", async () => {
    renderHook(() => useAutomationsSync());
    const { result } = renderHook(() => useHasActiveRun("a-1"));

    act(() => emit("automation_run:changed", run("r-1", "running")));
    expect(result.current).toBe(true);

    act(() => emit("automation_run:changed", run("r-1", "succeeded")));
    expect(result.current).toBe(false);
  });
});
