import { create } from "zustand";

export interface ReviewQueueEntry {
  commitsAhead: number;
  hasStaged: boolean;
  hasUncommitted: boolean;
}

interface ReviewQueueData {
  /** workspace_id → review state. Only entries with commitsAhead > 0 or hasStaged are kept. */
  entriesByWorkspaceId: Record<string, ReviewQueueEntry>;
}

const reviewQueueStore = create<ReviewQueueData>(() => ({
  entriesByWorkspaceId: {},
}));

export const setReviewState = (
  workspaceId: string,
  entry: ReviewQueueEntry,
) => {
  reviewQueueStore.setState((state) => {
    const next = { ...state.entriesByWorkspaceId };
    if (entry.commitsAhead > 0 || entry.hasUncommitted) {
      next[workspaceId] = entry;
    } else {
      delete next[workspaceId];
    }

    return { entriesByWorkspaceId: next };
  });
};

export const clearReviewState = (workspaceId: string) => {
  reviewQueueStore.setState((state) => {
    if (!(workspaceId in state.entriesByWorkspaceId)) {
      return state;
    }
    const next = { ...state.entriesByWorkspaceId };
    delete next[workspaceId];

    return { entriesByWorkspaceId: next };
  });
};

export const useReviewQueueMap = () =>
  reviewQueueStore((s) => s.entriesByWorkspaceId);

export const useReviewQueueCount = () =>
  reviewQueueStore((s) => Object.keys(s.entriesByWorkspaceId).length);

export const getReviewQueueState = () => reviewQueueStore.getState();
