import type { ActivityEvent } from "../lib/activityTypes";
import { create } from "zustand";

const MAX_EVENTS = 500;

interface ActivityStoreData {
  /** Newest-first. Capped at MAX_EVENTS. */
  events: ActivityEvent[];
}

const activityStore = create<ActivityStoreData>(() => ({
  events: [],
}));

/**
 * Append an activity event to the ring. Newest entries go to the front; older
 * entries are evicted when the ring is full.
 */
export const recordActivity = (
  event: Omit<ActivityEvent, "id" | "ts"> & { id?: string; ts?: number },
) => {
  const full: ActivityEvent = {
    id: event.id ?? crypto.randomUUID(),
    ts: event.ts ?? Date.now(),
    ...event,
  };

  activityStore.setState((state) => {
    const next = [full, ...state.events];
    if (next.length > MAX_EVENTS) {
      next.length = MAX_EVENTS;
    }

    return { events: next };
  });
};

export const clearActivity = () => {
  activityStore.setState({ events: [] });
};

export const useActivityEvents = () => activityStore((s) => s.events);

export const useActivityCount = () => activityStore((s) => s.events.length);

export const getActivityState = () => activityStore.getState();
