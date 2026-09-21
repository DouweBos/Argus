import type { MediaRouter, TransferChannel } from "@argus/remote-client";

/**
 * The one shape `invoke()` / `send()` / `listen()` talk to. Local mode is
 * Electron IPC on this Mac; remote mode is the Noise gateway on a paired host.
 * Nothing above `app/lib/ipc.ts` may know which is in play.
 */
export interface ArgusTransport {
  invoke: <T>(channel: string, args?: Record<string, unknown>) => Promise<T>;
  /**
   * Binary device-screen frames. Remote mode only: video rides the TAG_MEDIA
   * channel, not the forwarded event path, so local mode leaves it unset and
   * the runtime panel falls back to its IPC frames.
   */
  media?: MediaRouter;
  on: <T>(event: string, callback: (payload: T) => void) => () => void;
  send: (channel: string, args?: Record<string, unknown>) => void;
  /**
   * Chunked binary file transfer. Remote mode only: locally a dropped file is
   * already a path on the machine holding the worktree, so nothing serialises.
   * Callers feature-detect this the way the video hooks pick their source.
   */
  transfers?: TransferChannel;
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

/**
 * A call aimed at a host that is not answering — detached, or its socket is
 * down. Thrown instead of hanging on the request timeout so the UI can say
 * which machine is missing while the rest keep working.
 */
export class HostUnavailableError extends Error {
  constructor(
    readonly hostId: string,
    hostLabel: string,
  ) {
    super(`${hostLabel} is not connected right now.`);
    this.name = "HostUnavailableError";
  }
}
