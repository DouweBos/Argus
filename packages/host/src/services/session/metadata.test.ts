import fs from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getMeta,
  loadMetadata,
  migrateOrphaned,
  saveMetadata,
  type SessionMeta,
} from "./metadata";
import { resetAvailabilityCache } from "./volumeAvailability";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof fs>("node:fs");

  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      renameSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
  };
});

const mockReadFileSync = vi.mocked(fs.readFileSync);

describe("getMeta", () => {
  it("looks up by normalized path", () => {
    const meta = new Map<string, SessionMeta>();
    meta.set("/home/user/.argus/worktrees/App/feature", {
      id: "ws-1",
      description: "Test",
    });

    // Trailing slash should still match
    const result = getMeta(meta, "/home/user/.argus/worktrees/App/feature/");
    expect(result?.id).toBe("ws-1");
  });

  it("normalizes backslashes", () => {
    const meta = new Map<string, SessionMeta>();
    meta.set("C:/Users/dev/worktrees/App/feature", {
      id: "ws-1",
      description: "Test",
    });

    const result = getMeta(meta, "C:\\Users\\dev\\worktrees\\App\\feature");
    expect(result?.id).toBe("ws-1");
  });

  it("returns undefined for missing path", () => {
    const meta = new Map<string, SessionMeta>();
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
      JSON.stringify({ version: 999, sessions: {} }),
    );
    const result = loadMetadata("/worktrees");
    expect(result.size).toBe(0);
  });

  it("loads valid metadata with normalized keys", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        version: 2,
        sessions: {
          "/path/to/ws/": { id: "ws-1", description: "Test session" },
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

  it("migrates the index that used to live beside the worktrees", () => {
    // Keyed by path, not call order: resolving the roots reads the settings
    // files too, and those reads sit in the middle of this sequence.
    mockReadFileSync.mockImplementation((file) => {
      if (String(file).endsWith(".argus-sessions.json")) {
        return JSON.stringify({
          version: 1,
          sessions: {
            "/old/path": { id: "ws-old", description: "On the volume" },
          },
        });
      }
      throw new Error("ENOENT");
    });

    const result = loadMetadata("/repo");
    expect(result.get("/old/path")?.id).toBe("ws-old");
    // Written forward, so the drive is never needed for this again.
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it("still reads the pre-rename .argus-workspaces.json", () => {
    mockReadFileSync.mockImplementation((file) => {
      if (String(file).endsWith(".argus-workspaces.json")) {
        return JSON.stringify({
          version: 1,
          workspaces: {
            "/legacy/path": { id: "ws-legacy", description: "Pre-rename" },
          },
        });
      }
      throw new Error("ENOENT");
    });

    const result = loadMetadata("/repo");
    expect(result.get("/legacy/path")?.id).toBe("ws-legacy");
  });

  it("prefers the durable index over anything left on the volume", () => {
    mockReadFileSync.mockReturnValueOnce(
      JSON.stringify({
        version: 2,
        sessions: {
          "/new/path": { id: "ws-new", description: "Durable index" },
        },
      }),
    );

    const result = loadMetadata("/repo");
    expect(result.get("/new/path")?.id).toBe("ws-new");
    // The volume is never touched once the index exists — that is the point.
    expect(mockReadFileSync).toHaveBeenCalledTimes(1);
  });
});

/**
 * An ejected drive and a deleted directory are indistinguishable to
 * `existsSync`, and treating the first as the second is unrecoverable: the
 * metadata carries the session's name and description, and nothing else does.
 */
describe("migrateOrphaned", () => {
  const entry = (id: string): SessionMeta => ({
    id,
    display_name: null,
    description: "",
    base_branch: null,
  });

  beforeEach(() => {
    resetAvailabilityCache();
    vi.mocked(fs.existsSync).mockReset();
    vi.mocked(fs.mkdirSync).mockClear();
    vi.mocked(fs.writeFileSync).mockClear();
    vi.mocked(fs.renameSync).mockClear();
  });

  it("keeps entries whose volume is merely unplugged", () => {
    // Nothing under /Volumes exists: the drive is out.
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const meta = new Map([["/Volumes/Blackbox/App/feature", entry("ws-1")]]);
    const [migrated, removed] = migrateOrphaned("/Volumes/Blackbox/App", meta);

    expect(removed).toBe(false);
    expect(migrated.get("/Volumes/Blackbox/App/feature")?.id).toBe("ws-1");
  });

  it("still drops entries that are genuinely deleted", () => {
    // The drive is mounted; the worktree under it is not there.
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => String(p) === "/Volumes/Blackbox",
    );

    const meta = new Map([["/Volumes/Blackbox/App/feature", entry("ws-1")]]);
    const [migrated, removed] = migrateOrphaned("/Volumes/Blackbox/App", meta);

    expect(removed).toBe(true);
    expect(migrated.size).toBe(0);
  });

  it("writes the index to the internal disk, not the worktrees volume", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    saveMetadata(
      "/repo",
      new Map([["/Volumes/Blackbox/App/x", entry("ws-1")]]),
    );

    const target = String(vi.mocked(fs.renameSync).mock.calls[0]?.[1] ?? "");
    expect(target).not.toContain("/Volumes/");
    expect(target).toContain("sessions.json");
  });
});
