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
    if (entry.commitsAhead > 0 || entry.hasUncommitted) {
      return {
        entriesByWorkspaceId: {
          ...state.entriesByWorkspaceId,
          [workspaceId]: entry,
        },
      };
    }
    const { [workspaceId]: _removed, ...next } = state.entriesByWorkspaceId;

    return { entriesByWorkspaceId: next };
  });
};

export const clearReviewState = (workspaceId: string) => {
  reviewQueueStore.setState((state) => {
    if (!(workspaceId in state.entriesByWorkspaceId)) {
      return state;
    }
    const { [workspaceId]: _removed, ...next } = state.entriesByWorkspaceId;

    return { entriesByWorkspaceId: next };
  });
};

export const useReviewQueueMap = () =>
  reviewQueueStore((s) => s.entriesByWorkspaceId);

export const useReviewQueueCount = () =>
  reviewQueueStore((s) => Object.keys(s.entriesByWorkspaceId).length);

export const getReviewQueueState = () => reviewQueueStore.getState();
