// @vitest-environment jsdom
import type { DiffFile, DiffHunk, DiffLine } from "../../../../lib/diffParser";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangesSummary } from "./ChangesSummary";

// ---------------------------------------------------------------------------
// Mock hooks
// ---------------------------------------------------------------------------

const mockUseDiffFiles = vi.fn();
const mockUseMergeStatus = vi.fn();

vi.mock("../../../../hooks/useDiffFiles", () => ({
  useDiffFiles: (...args: unknown[]) => mockUseDiffFiles(...args),
}));

vi.mock("../../../../hooks/useMergeStatus", () => ({
  useMergeStatus: (...args: unknown[]) => mockUseMergeStatus(...args),
}));

// ---------------------------------------------------------------------------
// Mock workspace store
// ---------------------------------------------------------------------------

const mockUseWorkspaces = vi.fn();

vi.mock("../../../../stores/workspaceStore", () => ({
  useWorkspaces: () => mockUseWorkspaces(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLine(type: "add" | "context" | "remove"): DiffLine {
  return { type, content: "line" };
}

function makeHunk(adds: number, removes: number): DiffHunk {
  const lines: DiffLine[] = [];
  for (let i = 0; i < adds; i++) {
    lines.push(makeLine("add"));
  }
  for (let i = 0; i < removes; i++) {
    lines.push(makeLine("remove"));
  }

  return {
    header: "@@ -1,1 +1,1 @@",
    lines,
    oldStart: 1,
    newStart: 1,
    patch: "",
  };
}

function makeFile(path: string, adds: number, removes: number): DiffFile {
  return {
    oldPath: path,
    newPath: path,
    status: "M",
    staged: "none",
    hunks: [makeHunk(adds, removes)],
    diffHeader: "",
  };
}

function setupDefaults(
  overrides: {
    files?: DiffFile[];
    mergeStatus?: Record<string, unknown>;
    workspace?: Record<string, unknown> | null;
  } = {},
) {
  const files = overrides.files ?? [];
  const workspace = overrides.workspace ?? null;
  const mergeStatus = overrides.mergeStatus ?? {
    conflicts: [],
    hasStaged: false,
    isMerging: false,
    mergeError: null,
    handleMerge: vi.fn(),
  };

  mockUseDiffFiles.mockReturnValue({
    files,
    conflictFiles: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });

  mockUseMergeStatus.mockReturnValue(mergeStatus);

  mockUseWorkspaces.mockReturnValue(
    workspace ? [{ id: "ws-1", ...workspace }] : [],
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("changesSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when workspaceId is null", () => {
    setupDefaults();
    const { container } = render(<ChangesSummary workspaceId={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows empty state when no files changed", () => {
    setupDefaults({
      workspace: { kind: "repo_root" },
    });
    render(<ChangesSummary workspaceId="ws-1" />);
    expect(screen.getByText("No changes")).toBeTruthy();
  });

  it("renders file list with correct filenames and directories", () => {
    setupDefaults({
      files: [
        makeFile("src/pages/api/search.ts", 10, 2),
        makeFile("src/components/Box.tsx", 5, 0),
      ],
      workspace: { kind: "repo_root" },
    });
    render(<ChangesSummary workspaceId="ws-1" />);

    expect(screen.getByText("search.ts")).toBeTruthy();
    expect(screen.getByText("src/pages/api")).toBeTruthy();
    expect(screen.getByText("Box.tsx")).toBeTruthy();
    expect(screen.getByText("src/components")).toBeTruthy();
  });

  it("shows per-file addition and deletion stats", () => {
    setupDefaults({
      files: [makeFile("file.ts", 10, 3)],
      workspace: { kind: "repo_root" },
    });
    render(<ChangesSummary workspaceId="ws-1" />);

    // +10 and -3 appear in both the header and the file row
    expect(screen.getAllByText("+10")).toHaveLength(2);
    expect(screen.getAllByText("-3")).toHaveLength(2);
  });

  it("shows total additions/deletions in stats header", () => {
    setupDefaults({
      files: [makeFile("a.ts", 10, 2), makeFile("b.ts", 5, 3)],
      workspace: { kind: "repo_root" },
    });
    render(<ChangesSummary workspaceId="ws-1" />);

    expect(screen.getByText("+15")).toBeTruthy();
    expect(screen.getByText("-5")).toBeTruthy();
    expect(screen.getByText("2 files changed")).toBeTruthy();
  });

  it("file navigation arrows cycle through files", () => {
    setupDefaults({
      files: [
        makeFile("a.ts", 1, 0),
        makeFile("b.ts", 2, 0),
        makeFile("c.ts", 3, 0),
      ],
      workspace: { kind: "repo_root" },
    });
    render(<ChangesSummary workspaceId="ws-1" />);

    expect(screen.getByText("1/3 files")).toBeTruthy();

    // Use the text-based approach: find the next button (second nav button)
    fireEvent.click(screen.getByText("1/3 files").nextElementSibling!);

    expect(screen.getByText("2/3 files")).toBeTruthy();
  });

  it("prev button is disabled at first file", () => {
    setupDefaults({
      files: [makeFile("a.ts", 1, 0), makeFile("b.ts", 2, 0)],
      workspace: { kind: "repo_root" },
    });
    render(<ChangesSummary workspaceId="ws-1" />);

    // The prev button (before "1/2 files" label) should be disabled
    const label = screen.getByText("1/2 files");
    const prevBtn = label.previousElementSibling as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
  });

  it("next button is disabled at last file", () => {
    setupDefaults({
      files: [makeFile("a.ts", 1, 0)],
      workspace: { kind: "repo_root" },
    });
    render(<ChangesSummary workspaceId="ws-1" />);

    const label = screen.getByText("1/1 files");
    const nextBtn = label.nextElementSibling as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
  });

  it("shows merge section only for worktree workspaces with base_branch", () => {
    const handleMerge = vi.fn();
    setupDefaults({
      files: [makeFile("a.ts", 1, 0)],
      workspace: { kind: "worktree", base_branch: "main" },
      mergeStatus: {
        conflicts: [],
        hasStaged: true,
        isMerging: false,
        mergeError: null,
        handleMerge,
      },
    });
    render(<ChangesSummary workspaceId="ws-1" />);

    expect(screen.getByText("Apply Changes Locally")).toBeTruthy();
  });

  it("hides merge section for repo_root workspaces", () => {
    setupDefaults({
      files: [makeFile("a.ts", 1, 0)],
      workspace: { kind: "repo_root" },
    });
    render(<ChangesSummary workspaceId="ws-1" />);

    expect(screen.queryByText("Apply Changes Locally")).toBeNull();
  });

  it("merge button is disabled when nothing staged", () => {
    setupDefaults({
      files: [makeFile("a.ts", 1, 0)],
      workspace: { kind: "worktree", base_branch: "main" },
      mergeStatus: {
        conflicts: [],
        hasStaged: false,
        isMerging: false,
        mergeError: null,
        handleMerge: vi.fn(),
      },
    });
    render(<ChangesSummary workspaceId="ws-1" />);

    const mergeBtn = screen
      .getByText("Apply Changes Locally")
      .closest("button") as HTMLButtonElement;
    expect(mergeBtn.disabled).toBe(true);
  });

  it("merge button is disabled when conflicts exist", () => {
    setupDefaults({
      files: [makeFile("a.ts", 1, 0)],
      workspace: { kind: "worktree", base_branch: "main" },
      mergeStatus: {
        conflicts: ["file.ts"],
        hasStaged: true,
        isMerging: false,
        mergeError: null,
        handleMerge: vi.fn(),
      },
    });
    render(<ChangesSummary workspaceId="ws-1" />);

    const mergeBtn = screen
      .getByText("Apply Changes Locally")
      .closest("button") as HTMLButtonElement;
    expect(mergeBtn.disabled).toBe(true);
  });

  it("merge button calls handleMerge on click", () => {
    const handleMerge = vi.fn();
    setupDefaults({
      files: [makeFile("a.ts", 1, 0)],
      workspace: { kind: "worktree", base_branch: "main" },
      mergeStatus: {
        conflicts: [],
        hasStaged: true,
        isMerging: false,
        mergeError: null,
        handleMerge,
      },
    });
    render(<ChangesSummary workspaceId="ws-1" />);

    fireEvent.click(screen.getByText("Apply Changes Locally"));
    expect(handleMerge).toHaveBeenCalledTimes(1);
  });
});
