/**
 * The GitHub source's two contracts: a failing `gh` yields nothing rather than
 * throwing, and a row that does come back is normalized into a `WorkItem`.
 */

import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";

// Drive `gh` per test. The real execFile carries a promisify.custom override
// so `promisify(execFile)` resolves `{ stdout, stderr }`; replicate it here.
vi.mock("node:child_process", () => {
  const promisifyCustom = Symbol.for("nodejs.util.promisify.custom");
  const mockExecFile = vi.fn();
  (mockExecFile as unknown as Record<symbol, unknown>)[promisifyCustom] = (
    file: string,
    args: string[],
  ) =>
    new Promise((resolve, reject) => {
      (mockExecFile as unknown as (...a: unknown[]) => void)(
        file,
        args,
        (err: Error | null, stdout: string, stderr: string) => {
          if (err) {
            reject(err);
          } else {
            resolve({ stdout, stderr });
          }
        },
      );
    });

  return { execFile: mockExecFile };
});

vi.mock("../../mcp/projectDiscovery", () => ({
  collectAllProjects: vi.fn(() => []),
}));

vi.mock("../../github/pullRequests", () => ({
  getGithubSlugs: vi.fn(async () => []),
}));

const { execFile } = await import("node:child_process");
const { getGithubSlugs } = await import("../../github/pullRequests");
const { githubSource, toWorkItem } = await import("./github");

const mockExecFile = execFile as unknown as Mock;
const mockGetGithubSlugs = vi.mocked(getGithubSlugs);

type ExecCb = (err: Error | null, stdout: string, stderr: string) => void;

/** Reply to every `gh` call with the same JSON payload. */
function ghReturns(stdout: string): void {
  mockExecFile.mockImplementation(
    (_file: string, _args: string[], cb: ExecCb) => cb(null, stdout, ""),
  );
}

/** Make every `gh` call fail, the way a logged-out CLI does. */
function ghFails(): void {
  mockExecFile.mockImplementation(
    (_file: string, _args: string[], cb: ExecCb) =>
      cb(new Error("gh: not logged in"), "", ""),
  );
}

const ISSUE_ROW = {
  number: 412,
  title: "Fix the null crash",
  body: "It crashes.",
  state: "open",
  url: "https://github.com/acme/app/issues/412",
  repository: { nameWithOwner: "acme/app", name: "app" },
  labels: [{ name: "bug" }, { name: "p1" }],
  assignees: [{ login: "douwe" }],
  updatedAt: "2026-09-17T10:00:00Z",
};

describe("github signal source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGithubSlugs.mockResolvedValue([]);
  });

  describe("githubSource.isAvailable", () => {
    it("is false when gh fails", async () => {
      ghFails();
      await expect(githubSource.isAvailable()).resolves.toBe(false);
    });

    it("is true when gh auth status succeeds", async () => {
      ghReturns("Logged in to github.com");
      await expect(githubSource.isAvailable()).resolves.toBe(true);
    });
  });

  describe("githubSource.fetchAssigned", () => {
    it("returns an empty list when gh is logged out, rather than throwing", async () => {
      ghFails();
      await expect(
        githubSource.fetchAssigned!({ repoRoots: ["/repo"] }),
      ).resolves.toEqual([]);
    });

    it("returns an empty list when gh prints something that is not JSON", async () => {
      ghReturns("not json at all");
      await expect(
        githubSource.fetchAssigned!({ repoRoots: [] }),
      ).resolves.toEqual([]);
    });

    it("normalizes rows and dedupes an item that is both assigned and review-requested", async () => {
      ghReturns(JSON.stringify([ISSUE_ROW]));
      const items = await githubSource.fetchAssigned!({ repoRoots: [] });

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        source_id: "github",
        external_id: "acme/app#412",
        title: "Fix the null crash",
        labels: ["bug", "p1"],
        assignee: "douwe",
        state: "open",
      });
    });

    it("resolves repo_root from the project whose remote matches the item", async () => {
      mockGetGithubSlugs.mockResolvedValue(["acme/app"]);
      ghReturns(JSON.stringify([ISSUE_ROW]));

      const items = await githubSource.fetchAssigned!({
        repoRoots: ["/src/app"],
      });
      expect(items[0].repo_root).toBe("/src/app");
    });
  });

  describe("toWorkItem", () => {
    it("drops a row with no repository or number", () => {
      expect(toWorkItem({ title: "orphan" }, "issue", new Map())).toBeNull();
    });

    it("falls back to 0 for an unparseable timestamp and null repo_root", () => {
      const item = toWorkItem(
        { ...ISSUE_ROW, updatedAt: "whenever" },
        "pull_request",
        new Map(),
      );
      expect(item).toMatchObject({
        updated_at: 0,
        repo_root: null,
        kind: "pull_request",
      });
    });
  });
});
