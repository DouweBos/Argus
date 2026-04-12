import fs from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadStagehandConfig } from "./setup";

// Mock fs so we don't hit the real filesystem
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

// Mock main.ts to avoid Electron imports
vi.mock("../../main", () => ({
  getMainWindow: () => null,
}));

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

describe("loadStagehandConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns default config when no files exist", () => {
    mockExistsSync.mockReturnValue(false);
    const config = loadStagehandConfig("/repo");
    expect(config.setup.copy).toEqual([]);
    expect(config.setup.symlink).toEqual([]);
    expect(config.setup.commands).toEqual([]);
    expect(config.terminals).toEqual([]);
    expect(config.workspace_env).toEqual([]);
    expect(config.run).toBeNull();
  });

  it("parses .stagehand.json with setup block", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return (
        String(p).endsWith(".stagehand.json") && !String(p).includes("local")
      );
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        setup: {
          copy: ["node_modules"],
          symlink: [".env"],
          commands: ["pnpm install"],
        },
      }),
    );

    const config = loadStagehandConfig("/repo");
    expect(config.setup.copy).toEqual(["node_modules"]);
    expect(config.setup.symlink).toEqual([".env"]);
    expect(config.setup.commands).toEqual(["pnpm install"]);
  });

  it("handles run as a plain string", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return (
        String(p).endsWith(".stagehand.json") && !String(p).includes("local")
      );
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ run: "pnpm start" }));

    const config = loadStagehandConfig("/repo");
    expect(config.run).toEqual({ command: "pnpm start" });
  });

  it("handles run as an object", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return (
        String(p).endsWith(".stagehand.json") && !String(p).includes("local")
      );
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ run: { command: "npm start", dir: "packages/app" } }),
    );

    const config = loadStagehandConfig("/repo");
    expect(config.run).toEqual({ command: "npm start", dir: "packages/app" });
  });

  it("merges local config on top of base", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).includes("local")) {
        return JSON.stringify({
          setup: {
            copy: ["Pods"],
            symlink: [".env.local"],
            commands: [],
          },
          terminals: [{ name: "Local", dir: "." }],
        });
      }

      return JSON.stringify({
        setup: {
          copy: ["node_modules"],
          symlink: [".env"],
          commands: ["pnpm install"],
        },
        terminals: [{ name: "Shell", dir: "." }],
      });
    });

    const config = loadStagehandConfig("/repo");
    // copy should be deduped-concatenated
    expect(config.setup.copy).toEqual(["node_modules", "Pods"]);
    expect(config.setup.symlink).toEqual([".env", ".env.local"]);
    // commands from base kept, local has empty
    expect(config.setup.commands).toEqual(["pnpm install"]);
    // terminals concatenated
    expect(config.terminals).toHaveLength(2);
  });

  it("local workspace_env overrides base", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).includes("local")) {
        return JSON.stringify({
          setup: {},
          workspace_env: {
            name: "LOCAL_PORT",
            base_value: 4000,
            range: 50,
            strategy: "sequential",
          },
        });
      }

      return JSON.stringify({
        setup: {},
        workspace_env: {
          name: "PORT",
          base_value: 3000,
          range: 100,
          strategy: "hash",
        },
      });
    });

    const config = loadStagehandConfig("/repo");
    expect(config.workspace_env).toHaveLength(1);
    expect(config.workspace_env[0].name).toBe("LOCAL_PORT");
  });

  it("parses related_projects from config", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return (
        String(p).endsWith(".stagehand.json") && !String(p).includes("local")
      );
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        related_projects: [
          { path: "../backend", description: "Backend API" },
          { path: "../shared", description: "Shared lib" },
        ],
      }),
    );

    const config = loadStagehandConfig("/repo");
    expect(config.related_projects).toHaveLength(2);
    expect(config.related_projects![0]).toEqual({
      path: "../backend",
      description: "Backend API",
    });
    expect(config.related_projects![1]).toEqual({
      path: "../shared",
      description: "Shared lib",
    });
  });

  it("returns empty related_projects when field is absent", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return (
        String(p).endsWith(".stagehand.json") && !String(p).includes("local")
      );
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ setup: {} }));

    const config = loadStagehandConfig("/repo");
    expect(config.related_projects).toEqual([]);
  });

  it("filters invalid related_projects entries", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return (
        String(p).endsWith(".stagehand.json") && !String(p).includes("local")
      );
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        related_projects: [
          { path: "../valid", description: "Valid" },
          { description: "Missing path" },
          "not an object",
          null,
          { path: 123, description: "Numeric path" },
        ],
      }),
    );

    const config = loadStagehandConfig("/repo");
    expect(config.related_projects).toHaveLength(1);
    expect(config.related_projects![0].path).toBe("../valid");
  });

  it("defaults missing description to empty string in related_projects", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return (
        String(p).endsWith(".stagehand.json") && !String(p).includes("local")
      );
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        related_projects: [{ path: "../no-desc" }],
      }),
    );

    const config = loadStagehandConfig("/repo");
    expect(config.related_projects).toHaveLength(1);
    expect(config.related_projects![0].description).toBe("");
  });

  it("deduplicates related_projects when merging local config", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).includes("local")) {
        return JSON.stringify({
          setup: {},
          related_projects: [
            { path: "../backend", description: "Backend (local override)" },
            { path: "../new-project", description: "New project" },
          ],
        });
      }

      return JSON.stringify({
        setup: {},
        related_projects: [
          { path: "../backend", description: "Backend API" },
          { path: "../shared", description: "Shared lib" },
        ],
      });
    });

    const config = loadStagehandConfig("/repo");
    // backend should not be duplicated — base wins.
    expect(config.related_projects).toHaveLength(3);
    const paths = config.related_projects!.map((p) => p.path);
    expect(paths).toEqual(["../backend", "../shared", "../new-project"]);
    // Base description preserved for the duplicate.
    expect(config.related_projects![0].description).toBe("Backend API");
  });

  it("local browser_url overrides base when merging", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).includes("local")) {
        return JSON.stringify({
          setup: {},
          browser_url: "http://localhost:4000",
        });
      }

      return JSON.stringify({
        setup: {},
        browser_url: "http://localhost:3000",
      });
    });

    const config = loadStagehandConfig("/repo");
    expect(config.browser_url).toBe("http://localhost:4000");
  });

  it("keeps base browser_url when local omits it", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).includes("local")) {
        return JSON.stringify({ setup: {} });
      }

      return JSON.stringify({
        setup: {},
        browser_url: "http://localhost:3000",
      });
    });

    const config = loadStagehandConfig("/repo");
    expect(config.browser_url).toBe("http://localhost:3000");
  });

  it("throws on invalid JSON", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return (
        String(p).endsWith(".stagehand.json") && !String(p).includes("local")
      );
    });
    mockReadFileSync.mockReturnValue("{invalid json");

    expect(() => loadStagehandConfig("/repo")).toThrow();
  });
});
