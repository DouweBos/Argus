// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadyToMergeCard } from "./ReadyToMergeCard";

// ---------------------------------------------------------------------------
// Mock window.argus
// ---------------------------------------------------------------------------

type EventHandler = (payload: unknown) => void;
const eventListeners = new Map<string, Set<EventHandler>>();

(window as unknown as Record<string, unknown>).argus = {
  invoke: vi.fn().mockResolvedValue(undefined),
  on: (event: string, callback: EventHandler) => {
    if (!eventListeners.has(event)) {
      eventListeners.set(event, new Set());
    }
    eventListeners.get(event)!.add(callback);

    return () => {
      eventListeners.get(event)?.delete(callback);
    };
  },
};

// ---------------------------------------------------------------------------
// Hook + IPC mocks
// ---------------------------------------------------------------------------

interface MergeStatus {
  commitsAhead: number;
  commitsBehind: number;
  conflicts: string[];
  handleMerge: () => Promise<boolean>;
  handleRebase: () => Promise<void>;
  hasStaged: boolean;
  isMerging: boolean;
  isRebasing: boolean;
  mergeError: string | null;
  rebaseError: string | null;
}

const mockUseMergeStatus = vi.fn<(id: string | null) => MergeStatus>();
const mockUseFixConflictsInChat = vi.fn<
  (...args: unknown[]) => { dispatch: () => void; isDispatching: boolean }
>(() => ({
  dispatch: vi.fn(),
  isDispatching: false,
}));
const mockUseValidateChangesetsInChat = vi.fn<
  (...args: unknown[]) => {
    dispatch: () => void;
    error: string | null;
    isDispatching: boolean;
  }
>(() => ({
  dispatch: vi.fn(),
  error: null,
  isDispatching: false,
}));

vi.mock("../../../hooks/useMergeStatus", () => ({
  useMergeStatus: (id: string | null) => mockUseMergeStatus(id),
}));

const mockUseSessionReleaseNotes = vi.fn<(id: string) => unknown[]>(() => []);

vi.mock("../../../hooks/useSessionReleaseNotes", () => ({
  useSessionReleaseNotes: (id: string) => mockUseSessionReleaseNotes(id),
}));

vi.mock("../../../hooks/useFixConflictsInChat", () => ({
  useFixConflictsInChat: (arg: unknown) => mockUseFixConflictsInChat(arg),
}));

vi.mock("../../../hooks/useValidateChangesetsInChat", () => ({
  useValidateChangesetsInChat: (arg: unknown) =>
    mockUseValidateChangesetsInChat(arg),
}));

const mockDeleteSession = vi.fn().mockResolvedValue(undefined);
const mockWatchSession = vi.fn().mockResolvedValue(undefined);
const mockReadArgusConfig = vi
  .fn<(root: string) => Promise<Record<string, unknown>>>()
  .mockResolvedValue({ protected_branches: [] });
const mockPushSessionBranch = vi.fn().mockResolvedValue({
  branch: "feat",
  prUrl: "https://example.com/pr",
  remoteName: "origin",
});
const mockOpenExternalUrl = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../lib/ipc", () => ({
  deleteSession: (id: string, deleteBranch: boolean) =>
    mockDeleteSession(id, deleteBranch),
  openExternalUrl: (url: string) => mockOpenExternalUrl(url),
  pushSessionBranch: (id: string) => mockPushSessionBranch(id),
  readArgusConfig: (root: string) => mockReadArgusConfig(root),
  watchSession: (id: string) => mockWatchSession(id),
}));

vi.mock("../../../stores/notificationsStore", () => ({
  pushError: vi.fn(),
}));

vi.mock("../../../stores/layoutStore", () => ({
  setActiveTool: vi.fn(),
}));

vi.mock("../../pullRequests/CreatePullRequestDialog", () => ({
  CreatePullRequestDialog: ({ headBranch }: { headBranch: string }) => (
    <div data-testid="create-pr-dialog">{headBranch}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseStatus(overrides: Partial<MergeStatus> = {}): MergeStatus {
  return {
    commitsAhead: 0,
    commitsBehind: 0,
    conflicts: [],
    handleMerge: vi.fn().mockResolvedValue(true),
    handleRebase: vi.fn().mockResolvedValue(undefined),
    hasStaged: false,
    isMerging: false,
    isRebasing: false,
    mergeError: null,
    rebaseError: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readyToMergeCard", () => {
  beforeEach(() => {
    eventListeners.clear();
    mockUseMergeStatus.mockReturnValue(baseStatus());
    mockUseSessionReleaseNotes.mockReturnValue([]);
    mockUseFixConflictsInChat.mockReturnValue({
      dispatch: vi.fn(),
      isDispatching: false,
    });
    mockUseValidateChangesetsInChat.mockReturnValue({
      dispatch: vi.fn(),
      error: null,
      isDispatching: false,
    });
    mockReadArgusConfig.mockResolvedValue({ protected_branches: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when there is no work, no rebase need, and no footer", () => {
    const { container } = render(
      <ReadyToMergeCard
        baseBranch="main"
        repoRoot="/repo"
        sessionBranch="feat"
        sessionId="ws-1"
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("shows a Merge button for a non-protected base", async () => {
    mockUseMergeStatus.mockReturnValue(baseStatus({ commitsAhead: 2 }));

    render(
      <ReadyToMergeCard
        baseBranch="main"
        repoRoot="/repo"
        sessionBranch="feat"
        sessionId="ws-1"
      />,
    );

    await waitFor(() =>
      expect(mockReadArgusConfig).toHaveBeenCalledWith("/repo"),
    );

    expect(screen.getByRole("button", { name: /^Merge$/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Open PR/ })).toBeNull();
  });

  it("swaps Merge for Open PR when the base branch is protected", async () => {
    mockReadArgusConfig.mockResolvedValue({ protected_branches: ["main"] });
    mockUseMergeStatus.mockReturnValue(baseStatus({ commitsAhead: 1 }));

    render(
      <ReadyToMergeCard
        baseBranch="main"
        repoRoot="/repo"
        sessionBranch="feat"
        sessionId="ws-1"
      />,
    );

    const pushBtn = await screen.findByRole("button", {
      name: /Open PR/,
    });
    expect(pushBtn).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Merge$/ })).toBeNull();
  });

  it("opens the create-PR dialog when Open PR is clicked", async () => {
    mockReadArgusConfig.mockResolvedValue({ protected_branches: ["main"] });
    mockUseMergeStatus.mockReturnValue(baseStatus({ commitsAhead: 1 }));

    render(
      <ReadyToMergeCard
        baseBranch="main"
        repoRoot="/repo"
        sessionBranch="feat"
        sessionId="ws-1"
      />,
    );

    const pushBtn = await screen.findByRole("button", {
      name: /Open PR/,
    });

    expect(screen.queryByTestId("create-pr-dialog")).toBeNull();

    await act(async () => {
      fireEvent.click(pushBtn);
    });

    await waitFor(() => {
      expect(screen.getByTestId("create-pr-dialog")).toBeTruthy();
    });
  });

  it("does not flip to 'Merged' when handleMerge reports failure", async () => {
    const handleMerge = vi.fn().mockResolvedValue(false);
    mockUseMergeStatus.mockReturnValue(
      baseStatus({ commitsAhead: 1, handleMerge }),
    );

    render(
      <ReadyToMergeCard
        baseBranch="main"
        repoRoot="/repo"
        sessionBranch="feat"
        sessionId="ws-1"
      />,
    );

    const mergeBtn = await screen.findByRole("button", { name: /^Merge$/ });

    await act(async () => {
      fireEvent.click(mergeBtn);
    });

    expect(handleMerge).toHaveBeenCalled();
    // Regression: on failure we must NOT offer "Delete session".
    expect(screen.queryByRole("button", { name: /Delete session/ })).toBeNull();
    // The merge button should still be there so the user can retry.
    expect(screen.getByRole("button", { name: /^Merge$/ })).toBeTruthy();
  });

  it("flips to 'Merged' state when handleMerge reports success", async () => {
    const handleMerge = vi.fn().mockResolvedValue(true);
    mockUseMergeStatus.mockReturnValue(
      baseStatus({ commitsAhead: 1, handleMerge }),
    );

    render(
      <ReadyToMergeCard
        baseBranch="main"
        repoRoot="/repo"
        sessionBranch="feat"
        sessionId="ws-1"
      />,
    );

    const mergeBtn = await screen.findByRole("button", { name: /^Merge$/ });

    await act(async () => {
      fireEvent.click(mergeBtn);
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Delete session/ }),
      ).toBeTruthy(),
    );
  });

  it("shows a 'Fix … in chat' button when there are conflicts", () => {
    mockUseMergeStatus.mockReturnValue(
      baseStatus({
        commitsAhead: 1,
        conflicts: ["src/app.ts", "README.md"],
      }),
    );

    render(
      <ReadyToMergeCard
        baseBranch="main"
        repoRoot="/repo"
        sessionBranch="feat"
        sessionId="ws-1"
      />,
    );

    expect(
      screen.getByRole("button", { name: /Fix 2 conflicts in chat/ }),
    ).toBeTruthy();
    // Merge is hidden while conflicts exist.
    expect(screen.queryByRole("button", { name: /^Merge$/ })).toBeNull();
  });

  it("wires the Validate-with-agent button to the dispatch hook", async () => {
    const dispatch = vi.fn();
    mockUseValidateChangesetsInChat.mockReturnValue({
      dispatch,
      error: null,
      isDispatching: false,
    });
    mockUseMergeStatus.mockReturnValue(baseStatus({ commitsAhead: 1 }));
    mockUseSessionReleaseNotes.mockReturnValue([
      {
        filename: ".changeset/silly-cats-dance.md",
        format: "changesets",
        content: "Prevent a double-merge bug.",
        status: "added",
        labels: [{ name: "argus", value: "patch", tone: "success" }],
      },
    ]);

    render(
      <ReadyToMergeCard
        baseBranch="main"
        repoRoot="/repo"
        sessionBranch="feat"
        sessionId="ws-1"
      />,
    );

    const validateBtn = await screen.findByRole("button", {
      name: /Validate with agent/,
    });

    await act(async () => {
      fireEvent.click(validateBtn);
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("renders description and changesets inside the footer", () => {
    mockUseMergeStatus.mockReturnValue(baseStatus({ commitsAhead: 1 }));
    mockUseSessionReleaseNotes.mockReturnValue([
      {
        filename: ".changeset/silly-cats-dance.md",
        format: "changesets",
        content: "Prevent a double-merge bug.",
        status: "added",
        labels: [{ name: "argus", value: "patch", tone: "success" }],
      },
    ]);

    render(
      <ReadyToMergeCard
        baseBranch="main"
        description="Short description of the session."
        repoRoot="/repo"
        sessionBranch="feat"
        sessionId="ws-1"
      />,
    );

    expect(screen.getByText("Short description of the session.")).toBeTruthy();
    expect(screen.getByText(/1 changeset ready to merge/)).toBeTruthy();
    expect(screen.getByText(".changeset/silly-cats-dance.md")).toBeTruthy();
  });
});
