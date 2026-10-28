/**
 * Linear over the wire: reading an issue is monitor, moving or commenting on
 * one speaks for the computer's Linear user, so it is control.
 */

import type { GatewayContext } from "./capabilities";
import type { PairedDevice } from "./deviceStore";
import type { RemoteMethod } from "@argus/remote-protocol";
import {
  MethodResult,
  METHOD_SCOPE,
  REMOTE_METHODS,
} from "@argus/remote-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../state", () => ({
  appState: {
    agents: new Map(),
    agentPendingPermissions: new Map(),
    sessions: new Map(),
  },
}));
vi.mock("../integrations/service", () => ({
  listIntegrations: vi.fn(() => []),
  listLinearIssues: vi.fn(async () => []),
  getLinearIssue: vi.fn(),
  linearTeamStates: vi.fn(),
  updateLinearIssue: vi.fn(),
  commentOnLinearIssueById: vi.fn(async () => undefined),
}));

const { dispatch } = await import("./capabilities");
const service = vi.mocked(await import("../integrations/service"));

const STATE = { id: "st-2", name: "In Progress", type: "started", position: 2 };

const ISSUE = {
  id: "iss-1",
  identifier: "ENG-1",
  title: "Fix login",
  description: "",
  url: "https://linear.app/x/issue/ENG-1",
  branchName: "eng-1-fix-login",
  state: STATE,
  priority: 2,
  estimate: null,
  teamId: "team-1",
  teamKey: "ENG",
  teamName: "Engineering",
  assignee: null,
  assigneeAvatarUrl: null,
  labels: [],
  project: null,
  cycle: null,
  parent: null,
  pullRequestCount: 0,
  createdAt: 0,
  updatedAt: 0,
};

function ctx(capabilities: PairedDevice["capabilities"]): GatewayContext {
  return {
    device: {
      device_id: "dev-1",
      label: "Phone",
      dev_static_pub: "",
      capabilities,
      created_at: 0,
      last_seen: null,
    },
    connectionId: "conn-1",
    outstandingPermissions: new Set(),
  };
}

const WRITES = [
  "linear.update_issue",
  "linear.comment",
] as const satisfies readonly RemoteMethod[];

describe("linear over the wire", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads at monitor, writes at control, and never to a scoped grant", () => {
    expect(REMOTE_METHODS["linear.issue"]).toBe("monitor");
    for (const method of WRITES) {
      expect(REMOTE_METHODS[method]).toBe("control");
      expect(METHOD_SCOPE[method].kind).toBe("denied");
    }
    expect(METHOD_SCOPE["linear.issue"].kind).toBe("denied");
  });

  it("passes the scope through to the issue list", async () => {
    await dispatch("linear.issues", { scope: "created" }, ctx(["monitor"]));
    expect(service.listLinearIssues).toHaveBeenCalledWith(null, 30, "created");
  });

  it("returns an issue with its team's workflow", async () => {
    service.getLinearIssue.mockResolvedValue({
      ...ISSUE,
      comments: [],
      attachments: [],
      children: [],
    });
    service.linearTeamStates.mockResolvedValue([STATE]);

    const res = await dispatch(
      "linear.issue",
      { ref: "ENG-1" },
      ctx(["monitor"]),
    );

    expect(service.linearTeamStates).toHaveBeenCalledWith("team-1");
    expect(MethodResult["linear.issue"].parse(res)).toMatchObject({
      issue: { identifier: "ENG-1" },
      states: [STATE],
    });
  });

  it("still returns the issue when its workflow can't be read", async () => {
    service.getLinearIssue.mockResolvedValue({
      ...ISSUE,
      comments: [],
      attachments: [],
      children: [],
    });
    service.linearTeamStates.mockRejectedValue(new Error("rate limited"));

    const res = await dispatch(
      "linear.issue",
      { ref: "ENG-1" },
      ctx(["monitor"]),
    );

    expect(res).toMatchObject({ issue: { identifier: "ENG-1" }, states: [] });
  });

  it("answers null for an issue Linear doesn't have", async () => {
    service.getLinearIssue.mockResolvedValue(null);

    const res = await dispatch(
      "linear.issue",
      { ref: "nope" },
      ctx(["monitor"]),
    );

    expect(res).toEqual({ issue: null, states: [] });
    expect(service.linearTeamStates).not.toHaveBeenCalled();
  });

  it("denies every write to a monitor-only device", async () => {
    for (const method of WRITES) {
      await expect(
        dispatch(method, { issue_id: "iss-1", body: "hi" }, ctx(["monitor"])),
      ).rejects.toThrow(/capability/);
    }
    expect(service.updateLinearIssue).not.toHaveBeenCalled();
    expect(service.commentOnLinearIssueById).not.toHaveBeenCalled();
  });

  it("moves an issue for a control device", async () => {
    service.updateLinearIssue.mockResolvedValue(ISSUE);

    const res = await dispatch(
      "linear.update_issue",
      { issue_id: "iss-1", state_id: "st-2" },
      ctx(["monitor", "control"]),
    );

    expect(service.updateLinearIssue).toHaveBeenCalledWith("iss-1", {
      stateId: "st-2",
      priority: undefined,
    });
    expect(MethodResult["linear.update_issue"].parse(res).issue.id).toBe(
      "iss-1",
    );
  });

  it("refuses an update that changes nothing", async () => {
    await expect(
      dispatch(
        "linear.update_issue",
        { issue_id: "iss-1" },
        ctx(["monitor", "control"]),
      ),
    ).rejects.toThrow(/nothing to change/);
  });

  it("comments for a control device, and turns Linear's error into a sentence", async () => {
    await dispatch(
      "linear.comment",
      { issue_id: "iss-1", body: "On it" },
      ctx(["monitor", "control"]),
    );
    expect(service.commentOnLinearIssueById).toHaveBeenCalledWith(
      "iss-1",
      "On it",
    );

    service.commentOnLinearIssueById.mockRejectedValueOnce(
      new Error("Linear is down"),
    );
    await expect(
      dispatch(
        "linear.comment",
        { issue_id: "iss-1", body: "again" },
        ctx(["monitor", "control"]),
      ),
    ).rejects.toThrow("Linear is down");
  });
});
