import { create } from "zustand";

export interface ReviewQueueEntry {
  commitsAhead: number;
  hasStaged: boolean;
  hasUncommitted: boolean;
}

interface ReviewQueueData {
  /** session_id → review state. Only entries with commitsAhead > 0 or hasStaged are kept. */
  entriesBySessionId: Record<string, ReviewQueueEntry>;
}

const reviewQueueStore = create<ReviewQueueData>(() => ({
  entriesBySessionId: {},
}));

export const setReviewState = (sessionId: string, entry: ReviewQueueEntry) => {
  reviewQueueStore.setState((state) => {
    if (entry.commitsAhead > 0 || entry.hasUncommitted) {
      return {
        entriesBySessionId: {
          ...state.entriesBySessionId,
          [sessionId]: entry,
        },
      };
    }
    const { [sessionId]: _removed, ...next } = state.entriesBySessionId;

    return { entriesBySessionId: next };
  });
};

export const clearReviewState = (sessionId: string) => {
  reviewQueueStore.setState((state) => {
    if (!(sessionId in state.entriesBySessionId)) {
      return state;
    }
    const { [sessionId]: _removed, ...next } = state.entriesBySessionId;

    return { entriesBySessionId: next };
  });
};

export const useReviewQueueMap = () =>
  reviewQueueStore((s) => s.entriesBySessionId);

export const useReviewQueueCount = () =>
  reviewQueueStore((s) => Object.keys(s.entriesBySessionId).length);

export const getReviewQueueState = () => reviewQueueStore.getState();
