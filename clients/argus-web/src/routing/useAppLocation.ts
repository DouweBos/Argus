import { useMemo, useSyncExternalStore } from "react";
import {
  type AppLocation,
  currentLocation,
  locationKey,
  subscribeLocation,
} from "./router";

/** The screen and host the URL names, re-rendering on every navigation. */
export function useAppLocation(): AppLocation {
  const key = useSyncExternalStore(subscribeLocation, locationKey);

  // Keyed on the URL, so the screen object only changes when the URL does.
  return useMemo(() => currentLocation(), [key]);
}
