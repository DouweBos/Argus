// @vitest-environment jsdom

/**
 * `add_repo_root` / `remove_repo_root` name their subject `path`, which is not
 * a routing key — so without an explicit pin they follow the focused host.
 * Hydration runs before the remote host's tab exists, which sent every remote
 * project's registration to the local machine and failed with "Path is not a
 * directory" for anything that didn't happen to exist on both Macs.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveHostId } from "./transport/hostRouting";

const routedTo: Record<string, string> = {};

vi.mock("./ipc", () => ({
  addRepoRoot: vi.fn(async (path: string) => {
    routedTo.add_repo_root = resolveHostId("add_repo_root", { path });
  }),
  removeRepoRoot: vi.fn(async (path: string) => {
    routedTo.remove_repo_root = resolveHostId("remove_repo_root", { path });
  }),
  createHeadSession: vi.fn(async () => ({})),
  listSessions: vi.fn(async () => []),
  listProjects: vi.fn(async () => []),
}));
vi.mock("./repoBranchSync", () => ({
  refreshRepoBranch: vi.fn(async () => {}),
}));
vi.mock("./agentEventService", () => ({ stopAgentListening: vi.fn() }));

const REMOTE = "host-b";
const REMOTE_ONLY_PATH = "/Users/someone/Work/OnlyOnTheOtherMac";

describe("project registration routing", () => {
  beforeEach(async () => {
    const { _resetProjectsServiceForTest } = await import("./projectsService");
    _resetProjectsServiceForTest();
    delete routedTo.add_repo_root;
    delete routedTo.remove_repo_root;
  });

  it("registers a remote project on its own host, not the focused one", async () => {
    const { openProject } = await import("./projectsService");

    await openProject(REMOTE_ONLY_PATH, {
      hostId: REMOTE,
      autoSelect: false,
      skipRecent: true,
    });

    expect(routedTo.add_repo_root).toBe(REMOTE);
  });

  it("unregisters a remote project on its own host", async () => {
    const { closeProject, openProject } = await import("./projectsService");

    await openProject(REMOTE_ONLY_PATH, {
      hostId: REMOTE,
      autoSelect: false,
      skipRecent: true,
    });
    await closeProject(REMOTE_ONLY_PATH, REMOTE);

    expect(routedTo.remove_repo_root).toBe(REMOTE);
  });
});
