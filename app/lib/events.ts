/**
 * Event helpers for subscribing to backend events — from this Mac's main
 * process, or from the attached host's gateway. Same channel names either way.
 */

import { getTransport } from "./transport";

export type UnlistenFn = () => void;

/**
 * Subscribe to an event from the backend.
 * Returns a promise that resolves to an unlisten function.
 */
export function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  const unlisten = getTransport().on<T>(event, (payload) => {
    handler({ payload });
  });

  return Promise.resolve(unlisten);
}
