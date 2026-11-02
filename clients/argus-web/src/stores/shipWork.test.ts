// @vitest-environment jsdom
import type { Transport } from "@argus/remote-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBranchesStore } from "./branches";
import { useConnectionStore } from "./connection";
import { resetHostStores } from "./hostSync";
import { commitWork, pushWork } from "./land";
import {
  fillPullRequest,
  pullRequestKey,
  usePullRequestsStore,
} from "./pullRequests";

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

const STATUS = {
  status: {
    branch: "feature",
    upstream: null,
    ahead: 1,
    behind: 0,
    dirty_count: 0,
    stash_count: 0,
    conflict_count: 0,
    detached: false,
    last_fetch_at: null,
    in_progress: null,
  },
};

afterEach(() => resetHostStores());

describe("landing work", () => {
  it("commits the composed message, sending only the options set", async () => {
    const calls = fakeTransport({
      "sessions.commit": () => ({ output: "[feature abc] feat: x" }),
      "sessions.git_status": () => STATUS,
    });
    await commitWork(
      "s1",
      { summary: " feat: x ", description: "Why.\n" },
      { amend: false, signOff: true, sign: false },
    );
    expect(calls[0]).toEqual([
      "sessions.commit",
      {
        session_id: "s1",
        message: "feat: x\n\nWhy.",
        stage_all: true,
        sign_off: true,
      },
    ]);
  });

  it("lets a refused push reach the screen", async () => {
    fakeTransport({
      "sessions.push": () => {
        throw new Error("rejected (non-fast-forward)");
      },
      "sessions.git_status": () => STATUS,
    });
    await expect(pushWork("s1")).rejects.toThrow("non-fast-forward");
  });
});

describe("branches store", () => {
  it("reports a dirty checkout as a question, then stashes on the second ask", async () => {
    const calls = fakeTransport({
      "sessions.checkout": (p) =>
        p.dirty === "stash"
          ? { accepted: true }
          : { accepted: false, blocked_by: "dirty" },
      "sessions.branches": () => ({ branches: [] }),
      "sessions.git_status": () => STATUS,
    });
    const store = useBranchesStore.getState();
    expect(await store.checkout("s1", "main")).toBe("dirty");
    expect(await store.checkout("s1", "main", "stash")).toBe("ok");
    expect(calls.filter(([m]) => m === "sessions.checkout")[1][1]).toEqual({
      session_id: "s1",
      branch: "main",
      dirty: "stash",
    });
  });

  it("asks before forcing an unmerged delete", async () => {
    fakeTransport({
      "sessions.delete_branch": (p) =>
        p.force
          ? { accepted: true }
          : { accepted: false, blocked_by: "unmerged" },
      "sessions.branches": () => ({ branches: [] }),
      "sessions.git_status": () => STATUS,
    });
    const store = useBranchesStore.getState();
    expect(await store.remove("s1", "x", false)).toBe("unmerged");
    expect(await store.remove("s1", "x", true)).toBe("ok");
  });

  it("publishes a branch with no upstream", async () => {
    const calls = fakeTransport({
      "sessions.push_branch": () => ({ output: "" }),
      "sessions.branches": () => ({ branches: [] }),
      "sessions.git_status": () => STATUS,
    });
    await useBranchesStore.getState().push(
      "s1",
      {
        name: "x",
        scope: "local",
        is_current: true,
        upstream: null,
        ahead: 1,
        behind: 0,
      },
      false,
    );
    expect(calls[0][1]).toMatchObject({ set_upstream: true });
  });
});

describe("pull requests store", () => {
  it("explains gh being missing instead of showing an empty list", async () => {
    fakeTransport({
      "github.pull_requests": () => {
        throw new Error("spawn gh ENOENT");
      },
    });
    await usePullRequestsStore.getState().refresh();
    expect(usePullRequestsStore.getState().load.error).toMatch(
      /GitHub CLI \(gh\) is required/,
    );
  });

  it("opens, merges and comments, reloading the detail", async () => {
    const detail = { number: 3, repo: "o/r", title: "t", merged: true };
    const calls = fakeTransport({
      "github.create_pull_request": () => ({ number: 3, url: "https://x/3" }),
      "github.merge_pull_request": () => ({ accepted: true }),
      "github.comment_pull_request": () => ({ accepted: true }),
      "github.pull_request": () => ({ pull_request: detail }),
      "github.pull_requests": () => ({ pull_requests: [] }),
    });
    const store = usePullRequestsStore.getState();
    expect(await store.create("s1", "Title", "Body", true)).toBe("https://x/3");
    await store.merge("o/r", 3, "rebase");
    await store.comment("o/r", 3, "LGTM");
    expect(calls.map(([m]) => m)).toContain("github.merge_pull_request");
    expect(
      calls.find(([m]) => m === "github.merge_pull_request")?.[1],
    ).toEqual({ repo: "o/r", number: 3, strategy: "rebase" });
    await vi.waitFor(() =>
      expect(
        usePullRequestsStore.getState().detailById[pullRequestKey("o/r", 3)],
      ).toEqual(detail),
    );
  });

  it("turns a failed merge into a sentence", async () => {
    fakeTransport({
      "github.merge_pull_request": () => {
        throw new Error("Pull request is not mergeable");
      },
      "github.pull_request": () => {
        throw new Error("gone");
      },
      "github.pull_requests": () => ({ pull_requests: [] }),
    });
    await expect(
      usePullRequestsStore.getState().merge("o/r", 3, "squash"),
    ).rejects.toThrow("not mergeable");
  });

  it("hands back Claude's fill, or null when it couldn't", async () => {
    fakeTransport({ "github.fill_pull_request": () => ({ body: null }) });
    expect(await fillPullRequest("s1", "t")).toBeNull();
  });
});
