import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { appState } from "../../state";
import { isGitRepo, ensureRepoRegistered, collectAllProjects } from "./projects";

// Mock fs so we don't hit the real filesystem.
vi.mock("node:fs", () => {
  const actual = vi.importActual("node:fs");
  return {
    ...actual,
    default: {
      ...(actual as typeof fs),
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// Mock workspace manager to prevent real git/fs operations.
vi.mock("../workspace/manager", () => ({
  addRepoRoot: vi.fn(),
  createHeadWorkspace: vi.fn(),
}));

// Mock main.ts to avoid Electron imports.
vi.mock("../../main", () => ({
  getMainWindow: () => null,
}));

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const { addRepoRoot, createHeadWorkspace } = await import(
  "../workspace/manager"
);
const mockAddRepoRoot = vi.mocked(addRepoRoot);
const mockCreateHeadWorkspace = vi.mocked(createHeadWorkspace);

beforeEach(() => {
  vi.clearAllMocks();
  appState.repoRoots.clear();
  appState.workspaces.clear();
});

// ---------------------------------------------------------------------------
// isGitRepo
// ---------------------------------------------------------------------------

describe("isGitRepo", () => {
  it("returns true when .git exists", () => {
    mockExistsSync.mockReturnValue(true);
    expect(isGitRepo("/some/repo")).toBe(true);
    expect(mockExistsSync).toHaveBeenCalledWith(
      path.join("/some/repo", ".git"),
    );
  });

  it("returns false when .git does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(isGitRepo("/not/a/repo")).toBe(false);
  });

  it("returns false when existsSync throws", () => {
    mockExistsSync.mockImplementation(() => {
      throw new Error("permission denied");
    });
    expect(isGitRepo("/forbidden")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ensureRepoRegistered
// ---------------------------------------------------------------------------

describe("ensureRepoRegistered", () => {
  it("is a no-op when repo is already registered", () => {
    appState.repoRoots.add("/already/here");
    ensureRepoRegistered("/already/here");
    expect(mockAddRepoRoot).not.toHaveBeenCalled();
    expect(mockCreateHeadWorkspace).not.toHaveBeenCalled();
  });

  it("registers and creates head workspace for a valid git repo", () => {
    mockExistsSync.mockReturnValue(true); // .git exists
    ensureRepoRegistered("/new/repo");
    expect(mockAddRepoRoot).toHaveBeenCalledWith("/new/repo");
    expect(mockCreateHeadWorkspace).toHaveBeenCalledWith("/new/repo");
  });

  it("throws when the path is not a git repo", () => {
    mockExistsSync.mockReturnValue(false); // .git does not exist
    expect(() => ensureRepoRegistered("/not/git")).toThrow(
      "Not a git repository",
    );
    expect(mockAddRepoRoot).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// collectAllProjects
// ---------------------------------------------------------------------------

describe("collectAllProjects", () => {
  it("returns empty array when no repos are registered", () => {
    expect(collectAllProjects()).toEqual([]);
  });

  it("returns registered repos even without config files", () => {
    appState.repoRoots.add("/projects/frontend");
    // loadStagehandConfig will try to read files — make them not exist.
    mockExistsSync.mockReturnValue(false);

    const projects = collectAllProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      path: "/projects/frontend",
      registered: true,
      source: "/projects/frontend",
    });
    expect(projects[0].description).toContain("frontend");
  });

  it("discovers related projects from config", () => {
    appState.repoRoots.add("/projects/frontend");

    // Return .stagehand.json with related_projects for the frontend repo.
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      return s.endsWith(".stagehand.json") && !s.includes("local");
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        related_projects: [
          { path: "../backend", description: "Backend API" },
          { path: "../shared-lib", description: "Shared library" },
        ],
      }),
    );

    const projects = collectAllProjects();
    expect(projects).toHaveLength(3);

    const backend = projects.find((p) => p.path.endsWith("backend"));
    expect(backend).toBeDefined();
    expect(backend!.description).toBe("Backend API");
    expect(backend!.registered).toBe(false);
    expect(backend!.source).toBe("/projects/frontend");

    const shared = projects.find((p) => p.path.endsWith("shared-lib"));
    expect(shared).toBeDefined();
    expect(shared!.description).toBe("Shared library");
  });

  it("deduplicates when a related project is also registered", () => {
    appState.repoRoots.add("/projects/frontend");
    appState.repoRoots.add("/projects/backend");

    // Frontend config lists backend as related.
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      return s.endsWith(".stagehand.json") && !s.includes("local");
    });
    mockReadFileSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).startsWith("/projects/frontend")) {
        return JSON.stringify({
          related_projects: [
            { path: "../backend", description: "Backend API" },
          ],
        });
      }
      return JSON.stringify({});
    });

    const projects = collectAllProjects();
    // Should have exactly 2 entries, not 3 (no duplicate for backend).
    expect(projects).toHaveLength(2);

    const backend = projects.find((p) => p.path === "/projects/backend");
    expect(backend).toBeDefined();
    // Description should be upgraded from the generic "Registered project" to
    // the specific one from the related_projects config.
    expect(backend!.description).toBe("Backend API");
    expect(backend!.registered).toBe(true);
  });

  it("marks related projects as registered when they are in repoRoots", () => {
    appState.repoRoots.add("/projects/frontend");
    appState.repoRoots.add("/projects/backend");

    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      return s.endsWith(".stagehand.json") && !s.includes("local");
    });
    mockReadFileSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).startsWith("/projects/frontend")) {
        return JSON.stringify({
          related_projects: [
            { path: "../backend", description: "Backend API" },
          ],
        });
      }
      return JSON.stringify({});
    });

    const projects = collectAllProjects();
    const backend = projects.find((p) => p.path === "/projects/backend");
    expect(backend!.registered).toBe(true);
  });

  it("handles config load failure gracefully", () => {
    appState.repoRoots.add("/projects/broken");

    // Config file "exists" but readFileSync throws.
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error("corrupt file");
    });

    // Should not throw — just skip the broken config.
    const projects = collectAllProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].path).toBe("/projects/broken");
  });
});
