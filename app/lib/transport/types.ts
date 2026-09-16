/**
 * The one shape `invoke()` / `send()` / `listen()` talk to. Local mode is
 * Electron IPC on this Mac; remote mode is the Noise gateway on a paired host.
 * Nothing above `app/lib/ipc.ts` may know which is in play.
 */
export interface ArgusTransport {
  invoke: <T>(channel: string, args?: Record<string, unknown>) => Promise<T>;
  on: <T>(event: string, callback: (payload: T) => void) => () => void;
  send: (channel: string, args?: Record<string, unknown>) => void;
}

/**
 * A command that cannot cross the wire and has no sensible client-side stand-in
 * — "reveal in Finder" against a Mac mini in the corner. Thrown so the UI can
 * say so instead of silently doing nothing.
 */
export class RemoteUnavailableError extends Error {
  constructor(
    readonly command: string,
    hostLabel: string,
  ) {
    super(
      `"${command}" acts on the machine holding the files, so it isn't available while connected to ${hostLabel}.`,
    );
    this.name = "RemoteUnavailableError";
  }
}
