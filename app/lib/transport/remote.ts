/**
 * Remote transport: the same renderer commands, dispatched to a paired host
 * over the Noise gateway instead of this app's main process.
 *
 * The wire method *is* the IPC channel name — an admin-granted device calls
 * `start_agent` with the exact args the renderer passes today, so nothing above
 * `app/lib/ipc.ts` changes. Events arrive on their original channel names.
 */

import type { RemoteHost } from "../../stores/settingsStore";
import {
  MediaRouter,
  RemoteError,
  Transport,
  type ConnectionState,
  type EventEnvelope,
} from "@argus/remote-client";
import { localTransport } from "./local";
import { commandTarget } from "./routing";
import { RemoteUnavailableError, type ArgusTransport } from "./types";

/**
 * The gateway's subscription id for a channel, mirroring the host's
 * `rawSubscriptionScope`. Unsubscribed scopes are dropped before they reach the
 * wire, so a desktop watching four agents never streams a fifth's tokens.
 *
 * `agent:<kind>:<id>` → `<id>`; `terminal:data|exit:<id>` → `terminal:<id>`.
 * Everything else is unscoped and arrives without subscribing.
 */
function subscriptionScope(channel: string): string | null {
  const parts = channel.split(":");
  if (parts.length < 3) {
    return null;
  }
  if (parts[0] === "agent") {
    return parts.slice(2).join(":");
  }
  if (parts[0] === "terminal" && (parts[1] === "data" || parts[1] === "exit")) {
    return `terminal:${parts.slice(2).join(":")}`;
  }

  return null;
}

export interface RemoteTransportHandlers {
  onState: (state: ConnectionState) => void;
}

export class RemoteTransport implements ArgusTransport {
  /** Device-screen frames, keyed by the stream id `devices.watch` hands back. */
  readonly media = new MediaRouter();
  private readonly transport: Transport;
  private readonly listeners = new Map<
    string,
    Set<(payload: unknown) => void>
  >();
  /** Live gateway subscriptions, ref-counted by scope id. */
  private readonly subscriptionRefs = new Map<string, number>();

  constructor(
    private readonly host: RemoteHost,
    private readonly handlers: RemoteTransportHandlers,
  ) {
    this.transport = new Transport(
      {
        url: host.url,
        devPrivB64: host.devPrivB64,
        devPubB64: host.devPubB64,
        hostPubB64: host.hostPubB64,
      },
      {
        onState: (state) => this.onState(state),
        onEvent: (env) => this.onEvent(env),
        onMedia: (bytes) => this.media.push(bytes),
      },
    );
  }

  connect(): void {
    this.transport.connect();
  }

  disconnect(): void {
    this.transport.disconnect();
    this.media.clear();
  }

  private onState(state: ConnectionState): void {
    // Stream ids belong to one socket. The runtime panel re-watches on
    // reconnect and gets fresh ones, so nothing may survive the gap.
    if (state === "offline") {
      this.media.clear();
    }
    this.handlers.onState(state);
  }

  invoke<T>(channel: string, args?: Record<string, unknown>): Promise<T> {
    switch (commandTarget(channel)) {
      case "client":
        return localTransport.invoke<T>(channel, args);
      case "unavailable": {
        const error = new RemoteUnavailableError(channel, this.host.label);
        // Callers of these (reveal in Finder, open in editor) swallow their
        // rejections, so say it here or it degrades to nothing happening.
        import("../../stores/notificationsStore")
          .then(({ pushWarning }) => pushWarning(error.message, channel))
          .catch(() => undefined);

        return Promise.reject(error);
      }
      default:
        return this.transport.request<T>(channel, args ?? {});
    }
  }

  send(channel: string, args?: Record<string, unknown>): void {
    if (commandTarget(channel) !== "host") {
      localTransport.send(channel, args);

      return;
    }
    // No fire-and-forget envelope on the wire; drop the reply instead.
    this.transport.request(channel, args ?? {}).catch(() => undefined);
  }

  on<T>(event: string, callback: (payload: T) => void): () => void {
    const handler = callback as (payload: unknown) => void;
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    this.retain(event);

    return () => {
      set.delete(handler);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
      this.release(event);
    };
  }

  /** Subscribe on the gateway so this host only streams what we watch. */
  private retain(channel: string): void {
    const scope = subscriptionScope(channel);
    if (!scope) {
      return;
    }
    const next = (this.subscriptionRefs.get(scope) ?? 0) + 1;
    this.subscriptionRefs.set(scope, next);
    if (next === 1) {
      this.transport.subscribe(scope, true);
    }
  }

  private release(channel: string): void {
    const scope = subscriptionScope(channel);
    if (!scope) {
      return;
    }
    const next = (this.subscriptionRefs.get(scope) ?? 1) - 1;
    if (next <= 0) {
      this.subscriptionRefs.delete(scope);
      this.transport.subscribe(scope, false);
    } else {
      this.subscriptionRefs.set(scope, next);
    }
  }

  private onEvent(env: EventEnvelope): void {
    // Admin devices get every renderer broadcast forwarded verbatim, so the
    // desktop can keep listening on the channel names it already knows.
    if (env.event !== "ipc") {
      return;
    }
    const payload = env.payload as
      | { args?: unknown[]; channel?: string }
      | undefined;
    if (!payload?.channel) {
      return;
    }
    this.dispatch(payload.channel, payload.args?.[0]);
  }

  private dispatch(channel: string, payload: unknown): void {
    for (const handler of this.listeners.get(channel) ?? []) {
      try {
        handler(payload);
      } catch {
        // One bad subscriber must not stop delivery to the rest.
      }
    }
  }
}

export { RemoteError };
