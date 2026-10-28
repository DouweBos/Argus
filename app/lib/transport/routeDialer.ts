/**
 * Keeps one live gateway socket to a host across all of its routes. Dials the
 * best route first and falls back down the list when one doesn't answer; once
 * connected over a worse route it probes the better ones in the background and
 * only moves up after a probe completed a full handshake, so it never drops a
 * working socket for an address that isn't there.
 */

import type { RemoteEndpoint } from "../types";
import {
  Transport,
  type ConnectionState,
  type HostCredentials,
  type TransportHandlers,
} from "@argus/remote-client";
import {
  RETRY_BACKOFF_MS,
  UPGRADE_INTERVAL_MS,
  attemptTimeoutMs,
  nextRoute,
  rankRoutes,
  recordRoute,
  routeCandidates,
  sameRoutes,
  upgradeCandidate,
  type RouteCandidate,
  type RouteHealth,
} from "./endpointRanking";

export interface RouteDialerHooks extends Omit<TransportHandlers, "onState"> {
  /** A route completed a handshake: worth remembering as last-known-good. */
  onRoute?: (url: string) => void;
  onState: (state: ConnectionState) => void;
}

export interface RouteDialerOptions {
  /** The address that worked last time, ranked first among equals. */
  lastGoodUrl?: string;
  now?: () => number;
}

type Creds = Omit<HostCredentials, "url">;

export class RouteDialer {
  private ranked: RouteCandidate[];
  private health = new Map<string, RouteHealth>();
  private active: Transport | null = null;
  private activeRoute: RouteCandidate | null = null;
  private probe: Transport | null = null;
  private ready = false;
  private stopped = true;
  private tried = new Set<string>();
  private cycles = 0;
  private attemptTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private upgradeTimer: ReturnType<typeof setInterval> | null = null;
  private readonly scopes = new Set<string>();
  private readonly now: () => number;

  constructor(
    private readonly creds: Creds,
    url: string,
    endpoints: readonly RemoteEndpoint[] | undefined,
    private readonly hooks: RouteDialerHooks,
    options: RouteDialerOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    if (options.lastGoodUrl) {
      this.health.set(options.lastGoodUrl, {
        failures: 0,
        failedAt: null,
        lastGoodAt: 1,
      });
    }
    this.ranked = rankRoutes(routeCandidates(url, endpoints), this.health);
  }

  /** The socket requests go to, or null between attempts. */
  get transport(): Transport | null {
    return this.ready ? this.active : null;
  }

  get currentUrl(): string | null {
    return this.activeRoute?.url ?? null;
  }

  connect(): void {
    this.stopped = false;
    this.hooks.onState("connecting");
    this.startCycle();
  }

  disconnect(): void {
    this.stopped = true;
    this.clearTimers();
    this.closeProbe();
    this.active?.disconnect();
    this.active = null;
    this.activeRoute = null;
    this.ready = false;
    this.scopes.clear();
  }

  subscribe(scope: string, on: boolean): void {
    if (on) {
      this.scopes.add(scope);
    } else {
      this.scopes.delete(scope);
    }
    this.active?.subscribe(scope, on);
  }

  /** The host announced its routes; re-rank, keeping the live socket. */
  setEndpoints(url: string, endpoints: readonly RemoteEndpoint[]): void {
    const next = rankRoutes(routeCandidates(url, endpoints), this.health);
    if (sameRoutes(next, this.ranked)) {
      return;
    }
    this.ranked = next;
    this.scheduleUpgrades();
  }

  /** The network changed: retry now if down, look for a better route if up. */
  onNetworkChange(): void {
    if (this.stopped) {
      return;
    }
    if (this.ready) {
      this.checkUpgrade();
    } else if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.cycles = 0;
      this.startCycle();
    }
  }

  /** Probe the best route above the current one; move up if it answers. */
  checkUpgrade(): void {
    if (!this.ready || this.probe || !this.activeRoute) {
      return;
    }
    const target = upgradeCandidate(
      this.ranked,
      this.activeRoute.url,
      this.health,
      this.now(),
    );
    if (!target) {
      return;
    }
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      this.closeProbe();
      this.record(target.url, ok);
      if (ok && this.ready && !this.stopped) {
        this.moveTo(target);
      }
    };
    const timer = setTimeout(
      () => finish(false),
      attemptTimeoutMs(target.kind),
    );
    this.probe = new Transport(
      { ...this.creds, url: target.url },
      {
        onState: (state) => {
          if (state === "ready") {
            finish(true);
          } else if (state === "offline") {
            finish(false);
          }
        },
        onEvent: () => undefined,
      },
    );
    this.probe.connect();
  }

  private startCycle(): void {
    this.tried.clear();
    this.ranked = rankRoutes(this.ranked, this.health);
    const first = this.ranked[0];
    if (first) {
      this.dial(first);
    }
  }

  private dial(route: RouteCandidate): void {
    this.active?.disconnect();
    this.tried.add(route.url);
    this.activeRoute = route;
    this.ready = false;
    const transport = new Transport(
      { ...this.creds, url: route.url },
      {
        onState: (state) => this.onTransportState(transport, state),
        onEvent: (env) => {
          if (transport === this.active) {
            this.hooks.onEvent(env);
          }
        },
        onMedia: (bytes) => {
          if (transport === this.active) {
            this.hooks.onMedia?.(bytes);
          }
        },
        onXfer: (bytes) => {
          if (transport === this.active) {
            this.hooks.onXfer?.(bytes);
          }
        },
      },
    );
    this.active = transport;
    for (const scope of this.scopes) {
      transport.subscribe(scope, true);
    }
    this.attemptTimer = setTimeout(
      () => this.onAttemptFailed(transport),
      attemptTimeoutMs(route.kind),
    );
    transport.connect();
  }

  private onTransportState(transport: Transport, state: ConnectionState): void {
    if (transport !== this.active || this.stopped) {
      return;
    }
    if (state === "ready") {
      this.clearAttemptTimer();
      this.ready = true;
      this.cycles = 0;
      const url = this.activeRoute?.url;
      if (url) {
        this.record(url, true);
        this.hooks.onRoute?.(url);
      }
      this.hooks.onState("ready");
      this.scheduleUpgrades();

      return;
    }
    if (state === "offline") {
      if (this.ready) {
        // A working route dropped: say so, then start over from the best.
        this.ready = false;
        this.stopUpgrades();
        this.hooks.onState("offline");
        this.startCycle();
      } else {
        this.onAttemptFailed(transport);
      }

      return;
    }
    if (!this.ready && state === "handshaking") {
      this.hooks.onState(state);
    }
  }

  private onAttemptFailed(transport: Transport): void {
    if (transport !== this.active || this.stopped || this.ready) {
      return;
    }
    this.clearAttemptTimer();
    transport.disconnect();
    const failed = this.activeRoute;
    if (failed) {
      this.record(failed.url, false);
    }
    const next = failed ? nextRoute(this.ranked, failed.url, this.tried) : null;
    if (next) {
      this.dial(next);

      return;
    }
    this.active = null;
    this.hooks.onState("offline");
    const delay =
      RETRY_BACKOFF_MS[Math.min(this.cycles, RETRY_BACKOFF_MS.length - 1)];
    this.cycles += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) {
        this.hooks.onState("connecting");
        this.startCycle();
      }
    }, delay);
  }

  /** Leave the current socket for a route a probe just proved. */
  private moveTo(route: RouteCandidate): void {
    this.ready = false;
    this.stopUpgrades();
    this.hooks.onState("offline");
    this.tried.clear();
    this.dial(route);
  }

  private scheduleUpgrades(): void {
    this.stopUpgrades();
    const top = this.ranked[0];
    if (!this.ready || !top || !this.activeRoute) {
      return;
    }
    if (top.priority >= this.activeRoute.priority) {
      return;
    }
    this.upgradeTimer = setInterval(
      () => this.checkUpgrade(),
      UPGRADE_INTERVAL_MS,
    );
  }

  private record(url: string, ok: boolean): void {
    this.health = recordRoute(this.health, url, ok, this.now());
  }

  private closeProbe(): void {
    this.probe?.disconnect();
    this.probe = null;
  }

  private stopUpgrades(): void {
    if (this.upgradeTimer) {
      clearInterval(this.upgradeTimer);
      this.upgradeTimer = null;
    }
  }

  private clearAttemptTimer(): void {
    if (this.attemptTimer) {
      clearTimeout(this.attemptTimer);
      this.attemptTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearAttemptTimer();
    this.stopUpgrades();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}
