import fs from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { getMeta, loadMetadata, type WorkspaceMeta } from "./metadata";

vi.mock("node:fs", () => {
  const actual = vi.importActual("node:fs");

  return {
    ...actual,
    default: {
      ...(actual as typeof fs),
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

const mockReadFileSync = vi.mocked(fs.readFileSync);

describe("getMeta", () => {
  it("looks up by normalized path", () => {
    const meta = new Map<string, WorkspaceMeta>();
    meta.set("/home/user/.stagehand/worktrees/App/feature", {
      id: "ws-1",
      description: "Test",
    });

    // Trailing slash should still match
    const result = getMeta(
      meta,
      "/home/user/.stagehand/worktrees/App/feature/",
    );
    expect(result?.id).toBe("ws-1");
  });

  it("normalizes backslashes", () => {
    const meta = new Map<string, WorkspaceMeta>();
    meta.set("C:/Users/dev/worktrees/App/feature", {
      id: "ws-1",
      description: "Test",
    });

    const result = getMeta(meta, "C:\\Users\\dev\\worktrees\\App\\feature");
    expect(result?.id).toBe("ws-1");
  });

  it("returns undefined for missing path", () => {
    const meta = new Map<string, WorkspaceMeta>();
    expect(getMeta(meta, "/nonexistent")).toBeUndefined();
  });
});

describe("loadMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty map when file does not exist", () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = loadMetadata("/worktrees");
    expect(result.size).toBe(0);
  });

  it("returns empty map for invalid JSON", () => {
    mockReadFileSync.mockReturnValue("{not valid json");
    const result = loadMetadata("/worktrees");
    expect(result.size).toBe(0);
  });

  it("returns empty map for wrong schema version", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ version: 999, workspaces: {} }),
    );
    const result = loadMetadata("/worktrees");
    expect(result.size).toBe(0);
  });

  it("loads valid metadata with normalized keys", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: 1,
        workspaces: {
          "/path/to/ws/": { id: "ws-1", description: "Test workspace" },
          "/path/to/ws2": { id: "ws-2", description: "Another" },
        },
      }),
    );

    const result = loadMetadata("/worktrees");
    expect(result.size).toBe(2);
    // Trailing slash should be stripped in the normalized key
    expect(result.has("/path/to/ws")).toBe(true);
    expect(result.has("/path/to/ws2")).toBe(true);
  });
});
