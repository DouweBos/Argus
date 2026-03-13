/**
 * Event helpers for subscribing to Electron main-process events.
 */

export type UnlistenFn = () => void;

/**
 * Subscribe to an event from the main process.
 * Returns a promise that resolves to an unlisten function.
 */
export function listen<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  const unlisten = window.stagehand.on<T>(event, (payload) => {
    handler({ payload });
  });
  return Promise.resolve(unlisten);
}
