/**
 * Remote transport: the same renderer commands, dispatched to a paired host
 * over the Noise gateway instead of this app's main process.
 *
 * The wire method *is* the IPC channel name — an admin-granted device calls
 * `start_agent` with the exact args the renderer passes today, so nothing above
 * `app/lib/ipc.ts` changes. Events arrive on their original channel names.
 */

import type { RemoteHost } from "../../stores/settingsStore";
import type { RemoteEndpoint } from "../types";
import {
  MediaRouter,
  RemoteError,
  TransferChannel,
  type ConnectionState,
  type EventEnvelope,
} from "@argus/remote-client";
import { localTransport } from "./local";
import { RouteDialer } from "./routeDialer";
import { commandTarget } from "./routing";
import {
  HostUnavailableError,
  RemoteUnavailableError,
  type ArgusTransport,
} from "./types";

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
  /** The host's current routes, so the next launch can fall back too. */
  onEndpoints?: (endpoints: RemoteEndpoint[]) => void;
  /** A route just connected; remembered as the one to prefer next time. */
  onRoute?: (url: string) => void;
  onState: (state: ConnectionState) => void;
}

const offline = () =>
  Promise.reject(new RemoteError("offline", "not connected"));

export class RemoteTransport implements ArgusTransport {
  /** Device-screen frames, keyed by the stream id `devices.watch` hands back. */
  readonly media = new MediaRouter();
  /** Chunked file transfers — attachments and large reads, in both directions. */
  readonly transfers: TransferChannel;
  private readonly dialer: RouteDialer;
  private readonly listeners = new Map<
    string,
    Set<(payload: unknown) => void>
  >();
  /** Live gateway subscriptions, ref-counted by scope id. */
  private readonly subscriptionRefs = new Map<string, number>();
  private state: ConnectionState = "connecting";

  constructor(
    private readonly host: RemoteHost,
    private readonly handlers: RemoteTransportHandlers,
  ) {
    this.dialer = new RouteDialer(
      {
        devPrivB64: host.devPrivB64,
        devPubB64: host.devPubB64,
        hostPubB64: host.hostPubB64,
      },
      host.url,
      host.endpoints,
      {
        onState: (state) => this.onState(state),
        onEvent: (env) => this.onEvent(env),
        onMedia: (bytes) => this.media.push(bytes),
        onXfer: (bytes) => this.transfers.pushFrame(bytes),
        onRoute: (url) => this.handlers.onRoute?.(url),
      },
      { lastGoodUrl: host.url },
    );
    this.transfers = new TransferChannel({
      request: (method, params) => this.request(method, params),
      sendXfer: (body) => this.dialer.transport?.sendXfer(body),
      buffered: () => this.dialer.transport?.bufferedAmount ?? 0,
    });
  }

  connect(): void {
    this.dialer.connect();
  }

  disconnect(): void {
    this.dialer.disconnect();
    this.media.clear();
    this.transfers.reset();
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  /** The network changed: reconnect sooner, or try a better route. */
  onNetworkChange(): void {
    this.dialer.onNetworkChange();
  }

  private request<T>(method: string, params: unknown): Promise<T> {
    return this.dialer.transport?.request<T>(method, params) ?? offline();
  }

  private applyEndpoints(endpoints: RemoteEndpoint[]): void {
    this.dialer.setEndpoints(this.host.url, endpoints);
    this.handlers.onEndpoints?.(endpoints);
  }

  private onState(state: ConnectionState): void {
    this.state = state;
    // Stream ids belong to one socket. The runtime panel re-watches on
    // reconnect and gets fresh ones, so nothing may survive the gap.
    if (state === "offline") {
      this.media.clear();
      // Transfer ids belong to one socket; nothing in flight may hang.
      this.transfers.reset();
    }
    this.handlers.onState(state);
    if (state === "ready") {
      // Pushed only when they change, so ask once per connection.
      this.request<{ endpoints?: RemoteEndpoint[] }>("host.endpoints", {})
        .then((res) => {
          if (res.endpoints) {
            this.applyEndpoints(res.endpoints);
          }
        })
        .catch(() => undefined);
    }
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
        if (this.state === "offline") {
          // Fail now rather than after the 15s request timeout: the last
          // snapshot stays on screen, but nothing may pretend to be writing
          // to a machine that isn't there.
          return Promise.reject(
            new HostUnavailableError(this.host.id, this.host.label),
          );
        }

        return this.request<T>(channel, args ?? {});
    }
  }

  send(channel: string, args?: Record<string, unknown>): void {
    if (commandTarget(channel) !== "host") {
      localTransport.send(channel, args);

      return;
    }
    // No fire-and-forget envelope on the wire; drop the reply instead.
    this.request(channel, args ?? {}).catch(() => undefined);
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
      this.dialer.subscribe(scope, true);
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
      this.dialer.subscribe(scope, false);
    } else {
      this.subscriptionRefs.set(scope, next);
    }
  }

  private onEvent(env: EventEnvelope): void {
    if (env.event === "host.endpoints") {
      const endpoints = (env.payload as { endpoints?: RemoteEndpoint[] })
        ?.endpoints;
      if (endpoints) {
        this.applyEndpoints(endpoints);
      }

      return;
    }
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
