/**
 * Event helpers for subscribing to backend events — from this Mac's main
 * process, from one attached host, or from all of them at once. Same channel
 * names either way.
 *
 * Every delivery names the host it came from. Channel names are not unique
 * across machines (`session:created`, `agent:status:<id>`), so a listener that
 * cares which machine spoke must read `hostId` rather than assume.
 */

import type { HostId } from "./transport/hostId";
import { subscribe } from "./transport";

export type UnlistenFn = () => void;

export interface IpcEvent<T> {
  /** The machine this event came from. */
  hostId: HostId;
  payload: T;
}

export interface ListenOptions {
  /** Listen to one host only. Omit to hear from every attached host. */
  hostId?: HostId;
}

/**
 * Subscribe to an event from the backend.
 * Returns a promise that resolves to an unlisten function.
 */
export function listen<T>(
  event: string,
  handler: (event: IpcEvent<T>) => void,
  options?: ListenOptions,
): Promise<UnlistenFn> {
  const unlisten = subscribe(
    event,
    (payload, hostId) => {
      handler({ payload: payload as T, hostId });
    },
    options?.hostId,
  );

  return Promise.resolve(unlisten);
}
