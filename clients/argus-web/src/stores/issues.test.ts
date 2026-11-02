// @vitest-environment jsdom
import type { Transport } from "@argus/remote-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConnectionStore } from "./connection";
import { resetHostStores } from "./hostSync";
import {
  commentOnIssue,
  loadIssue,
  refreshIssues,
  searchIssues,
  updateIssue,
  useIssuesStore,
} from "./issues";
import { startFromIssues } from "./start";

const issue = {
  id: "i1",
  identifier: "ENG-1",
  title: "Fix login",
  description: "",
  url: "https://linear.app/x/issue/ENG-1",
  branchName: "eng-1-fix-login",
  state: { id: "s1", name: "Todo", type: "unstarted", position: 1 },
  priority: 2,
  estimate: null,
  teamId: "t",
  teamKey: "ENG",
  teamName: "Eng",
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

function fakeTransport(handlers: Record<string, (p: unknown) => unknown>) {
  const request = vi.fn(async (method: string, params: unknown) => {
    const handler = handlers[method];
    if (!handler) {
      throw new Error(`no ${method}`);
    }

    return handler(params);
  });
  useConnectionStore.setState({
    transport: { request } as unknown as Transport,
    connection: "ready",
  });

  return request;
}

beforeEach(() => resetHostStores());

describe("issues store", () => {
  it("lists a scope and swaps an update into it and the detail", async () => {
    fakeTransport({
      "linear.issues": () => ({ issues: [issue] }),
      "linear.issue": () => ({
        issue: { ...issue, comments: [], attachments: [], children: [] },
        states: [issue.state],
      }),
      "linear.update_issue": (p) => ({
        issue: { ...issue, priority: (p as { priority: number }).priority },
      }),
    });
    await refreshIssues("assigned");
    await loadIssue("ENG-1");
    await updateIssue("i1", { priority: 1 });
    const s = useIssuesStore.getState();
    expect(s.lists.assigned.data?.[0].priority).toBe(1);
    expect(s.details["ENG-1"].priority).toBe(1);
    expect(s.statesByTeam.t).toHaveLength(1);
  });

  it("lands only the latest search", async () => {
    let answer: (v: unknown) => void = () => {};
    fakeTransport({
      "linear.issues": (p) =>
        (p as { query: string }).query === "old"
          ? new Promise((r) => {
              answer = r;
            })
          : { issues: [issue] },
    });
    const old = searchIssues("old");
    await searchIssues("new");
    answer({ issues: [] });
    await old;
    expect(useIssuesStore.getState().search).toMatchObject({
      term: "new",
      data: [issue],
    });
  });

  it("comments in a thread, then reloads the issue", async () => {
    const request = fakeTransport({
      "linear.comment": () => ({ accepted: true }),
      "linear.issue": () => ({ issue: null, states: [] }),
    });
    await commentOnIssue(issue, "Looks good", "c1");
    expect(request).toHaveBeenCalledWith("linear.comment", {
      issue_id: "i1",
      body: "Looks good",
      parent_id: "c1",
    });
    expect(request).toHaveBeenLastCalledWith("linear.issue", { ref: "ENG-1" });
  });

  it("starts one worktree per issue on Linear's branch", async () => {
    const request = fakeTransport({
      "sessions.create": (p) => ({ session: { id: "s", ...(p as object) } }),
      "sessions.list": () => ({ sessions: [] }),
    });
    await startFromIssues([issue], "/repo", {
      baseBranch: "main",
      message: "",
      model: null,
      permissionMode: null,
      runnerId: null,
    });
    expect(request).toHaveBeenCalledWith("sessions.create", {
      repo_root: "/repo",
      branch: "eng-1-fix-login",
      description: "ENG-1",
      linear_issue: "ENG-1",
      base_branch: "main",
    });
  });
});
