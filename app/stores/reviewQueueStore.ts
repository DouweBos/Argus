import { create } from "zustand";

interface ReviewQueueData {
  /** workspace_id → commits ahead of base. Only entries with count > 0 are kept. */
  commitsAheadByWorkspaceId: Record<string, number>;
}

const reviewQueueStore = create<ReviewQueueData>(() => ({
  commitsAheadByWorkspaceId: {},
}));

export const setReviewState = (workspaceId: string, commitsAhead: number) => {
  reviewQueueStore.setState((state) => {
    const next = { ...state.commitsAheadByWorkspaceId };
    if (commitsAhead > 0) {
      next[workspaceId] = commitsAhead;
    } else {
      delete next[workspaceId];
    }

    return { commitsAheadByWorkspaceId: next };
  });
};

export const clearReviewState = (workspaceId: string) => {
  reviewQueueStore.setState((state) => {
    if (!(workspaceId in state.commitsAheadByWorkspaceId)) {
      return state;
    }
    const next = { ...state.commitsAheadByWorkspaceId };
    delete next[workspaceId];

    return { commitsAheadByWorkspaceId: next };
  });
};

export const useReviewQueueMap = () =>
  reviewQueueStore((s) => s.commitsAheadByWorkspaceId);

export const useReviewQueueCount = () =>
  reviewQueueStore((s) => Object.keys(s.commitsAheadByWorkspaceId).length);

export const getReviewQueueState = () => reviewQueueStore.getState();
