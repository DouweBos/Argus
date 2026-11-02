import fs from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadArgusConfig } from "./argusConfig";

// Mock fs so we don't hit the real filesystem
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof fs>("node:fs");

  return {
    ...actual,
    default: {
      ...actual,
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

describe("loadArgusConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns default config when no files exist", () => {
    mockExistsSync.mockReturnValue(false);
    const config = loadArgusConfig("/repo");
    expect(config.setup.copy).toEqual([]);
    expect(config.setup.symlink).toEqual([]);
    expect(config.setup.commands).toEqual([]);
    expect(config.terminals).toEqual([]);
    expect(config.workspace_env).toEqual([]);
    expect(config.run).toEqual([]);
  });

  it("parses .argus.json with setup block", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith(".argus.json") && !String(p).includes("local");
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

    const config = loadArgusConfig("/repo");
    expect(config.setup.copy).toEqual(["node_modules"]);
    expect(config.setup.symlink).toEqual([".env"]);
    expect(config.setup.commands).toEqual(["pnpm install"]);
  });

  it("parses run as an array of RunCommand entries", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith(".argus.json") && !String(p).includes("local");
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        run: [
          {
            title: "Dev",
            command: "pnpm dev",
            cwd: "packages/app",
            restartOnRerun: true,
          },
          { title: "Tests", command: "pnpm test", restartOnRerun: false },
        ],
      }),
    );

    const config = loadArgusConfig("/repo");
    expect(config.run).toEqual([
      {
        title: "Dev",
        command: "pnpm dev",
        cwd: "packages/app",
        restartOnRerun: true,
      },
      {
        title: "Tests",
        command: "pnpm test",
        cwd: undefined,
        restartOnRerun: false,
      },
    ]);
  });

  it("rejects the legacy string form of run", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith(".argus.json") && !String(p).includes("local");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ run: "pnpm start" }));

    expect(() => loadArgusConfig("/repo")).toThrow(/must be an array/);
  });

  it("merges local config on top of base", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
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

    const config = loadArgusConfig("/repo");
    // copy should be deduped-concatenated
    expect(config.setup.copy).toEqual(["node_modules", "Pods"]);
    expect(config.setup.symlink).toEqual([".env", ".env.local"]);
    // commands from base kept, local has empty
    expect(config.setup.commands).toEqual(["pnpm install"]);
    // terminals concatenated
    expect(config.terminals).toHaveLength(2);
  });

  it("keeps team booleans a local file leaves unset", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) =>
      String(p).includes("local")
        ? JSON.stringify({ browser_url: "http://localhost:3000" })
        : JSON.stringify({
            single_runtime: true,
            auto_continue_on_limit: true,
          }),
    );

    const config = loadArgusConfig("/repo");
    expect(config.single_runtime).toBe(true);
    expect(config.auto_continue_on_limit).toBe(true);
  });

  it("lets a local file override team booleans it sets", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) =>
      String(p).includes("local")
        ? JSON.stringify({
            single_runtime: false,
            auto_continue_on_limit: true,
          })
        : JSON.stringify({
            single_runtime: true,
            auto_continue_on_limit: false,
          }),
    );

    const config = loadArgusConfig("/repo");
    expect(config.single_runtime).toBe(false);
    expect(config.auto_continue_on_limit).toBe(true);
  });

  it("defaults unset booleans after merging", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({}));

    const config = loadArgusConfig("/repo");
    expect(config.single_runtime).toBe(false);
    expect(config.auto_continue_on_limit).toBe(false);
  });

  it("local workspace_env overrides base", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
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

    const config = loadArgusConfig("/repo");
    expect(config.workspace_env).toHaveLength(1);
    expect(config.workspace_env[0].name).toBe("LOCAL_PORT");
  });

  it("parses related_projects from config", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith(".argus.json") && !String(p).includes("local");
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        related_projects: [
          { path: "../backend", description: "Backend API" },
          { path: "../shared", description: "Shared lib" },
        ],
      }),
    );

    const config = loadArgusConfig("/repo");
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
      return String(p).endsWith(".argus.json") && !String(p).includes("local");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ setup: {} }));

    const config = loadArgusConfig("/repo");
    expect(config.related_projects).toEqual([]);
  });

  it("filters invalid related_projects entries", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith(".argus.json") && !String(p).includes("local");
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

    const config = loadArgusConfig("/repo");
    expect(config.related_projects).toHaveLength(1);
    expect(config.related_projects![0].path).toBe("../valid");
  });

  it("defaults missing description to empty string in related_projects", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith(".argus.json") && !String(p).includes("local");
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        related_projects: [{ path: "../no-desc" }],
      }),
    );

    const config = loadArgusConfig("/repo");
    expect(config.related_projects).toHaveLength(1);
    expect(config.related_projects![0].description).toBe("");
  });

  it("deduplicates related_projects when merging local config", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
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

    const config = loadArgusConfig("/repo");
    // backend should not be duplicated — base wins.
    expect(config.related_projects).toHaveLength(3);
    const paths = config.related_projects!.map((p) => p.path);
    expect(paths).toEqual(["../backend", "../shared", "../new-project"]);
    // Base description preserved for the duplicate.
    expect(config.related_projects![0].description).toBe("Backend API");
  });

  it("local browser_url overrides base when merging", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
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

    const config = loadArgusConfig("/repo");
    expect(config.browser_url).toBe("http://localhost:4000");
  });

  it("keeps base browser_url when local omits it", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).includes("local")) {
        return JSON.stringify({ setup: {} });
      }

      return JSON.stringify({
        setup: {},
        browser_url: "http://localhost:3000",
      });
    });

    const config = loadArgusConfig("/repo");
    expect(config.browser_url).toBe("http://localhost:3000");
  });

  it("parses object-form copy entries with excludes", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith(".argus.json") && !String(p).includes("local");
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        setup: {
          copy: [
            ".env",
            { path: ".claude", exclude: ["projects/**/worktrees/**"] },
          ],
          symlink: [{ path: ".env" }],
        },
      }),
    );

    const config = loadArgusConfig("/repo");
    expect(config.setup.copy).toEqual([
      ".env",
      { path: ".claude", exclude: ["projects/**/worktrees/**"] },
    ]);
    // No `exclude` → object form is preserved (still an object) so the rest
    // of the pipeline can treat all entries uniformly.
    expect(config.setup.symlink).toEqual([{ path: ".env" }]);
  });

  it("throws when a copy entry's path is missing", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith(".argus.json") && !String(p).includes("local");
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ setup: { copy: [{ exclude: ["foo"] }] } }),
    );
    expect(() => loadArgusConfig("/repo")).toThrow(/setup\.copy\[0]\.path/);
  });

  it("throws when a copy entry's exclude is not an array of strings", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith(".argus.json") && !String(p).includes("local");
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ setup: { copy: [{ path: ".claude", exclude: "x" }] } }),
    );
    expect(() => loadArgusConfig("/repo")).toThrow(/exclude/);
  });

  it("dedupes setup entries by path when merging local config", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).includes("local")) {
        return JSON.stringify({
          setup: {
            copy: [{ path: ".claude", exclude: ["projects/**"] }],
          },
        });
      }

      return JSON.stringify({ setup: { copy: [".claude", "node_modules"] } });
    });

    const config = loadArgusConfig("/repo");
    // Local's structured `.claude` replaces base's bare `.claude`; node_modules survives.
    expect(config.setup.copy).toEqual([
      "node_modules",
      { path: ".claude", exclude: ["projects/**"] },
    ]);
  });

  it("throws on invalid JSON", () => {
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith(".argus.json") && !String(p).includes("local");
    });
    mockReadFileSync.mockReturnValue("{invalid json");

    expect(() => loadArgusConfig("/repo")).toThrow();
  });
});
