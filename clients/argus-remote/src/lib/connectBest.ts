/**
 * Picks which of a computer's addresses to talk over.
 *
 * A desktop can be reachable several ways at once — the LAN, a Tailscale
 * funnel, a Cloudflare tunnel — and which ones work depends on where the phone
 * is. Rather than making the user choose, every candidate is dialled at once
 * and the simplest one that completes the pinned-key Noise handshake wins.
 *
 * The handshake (not just a socket open) is the test on purpose: a stale LAN IP
 * can be answered by a different machine, and a captive portal will happily
 * accept a connection to anything. Only the real desktop holds the pinned key,
 * so only the real desktop can reach `ready`.
 */

import { identityEndpoints, type DeviceIdentity } from "./keystore";
import { Transport, type TransportHandlers } from "./transport";

/**
 * How long to keep waiting for a better-ranked endpoint after a worse-ranked
 * one is already up. Cloudflare usually answers before a cold Tailscale dial,
 * and switching later would drop the connection, so it's worth a short pause.
 */
const GRACE_MS = 1200;

/** Give up on a candidate that never handshakes (blackholed LAN IP, dead tunnel). */
const PROBE_TIMEOUT_MS = 8000;

export interface ConnectAttempt {
  /** The live transport, already handshaked. */
  transport: Transport;
  /** Address that won, so the caller can remember it. */
  url: string;
}

interface Candidate {
  url: string;
  priority: number;
}

/**
 * Dial every known address and resolve with the best-ranked one that
 * handshakes. Rejects only when they all fail.
 *
 * `handlers` are attached to the winner; losers are torn down before it
 * resolves, so the caller never sees their state changes.
 */
export async function connectBestEndpoint(
  identity: DeviceIdentity,
  handlers: TransportHandlers,
): Promise<ConnectAttempt> {
  const candidates: Candidate[] = identityEndpoints(identity).map((e) => ({
    url: e.url,
    priority: e.priority,
  }));

  if (candidates.length === 0) {
    throw new Error("This computer has no known address.");
  }

  return await new Promise<ConnectAttempt>((resolve, reject) => {
    /** Handshaked and waiting to see if something better shows up. */
    let best: { transport: Transport; candidate: Candidate } | null = null;
    let settled = false;
    let pending = candidates.length;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    const probes = new Map<string, Transport>();
    /** Candidates that have already succeeded or failed. */
    const finished = new Set<string>();

    const cleanupLosers = (winner: Transport) => {
      for (const [, transport] of probes) {
        if (transport !== winner) {
          transport.disconnect();
        }
      }
    };

    const commit = () => {
      if (settled || !best) {
        return;
      }
      settled = true;
      if (graceTimer) {
        clearTimeout(graceTimer);
      }
      cleanupLosers(best.transport);
      // Hand the live session over: re-point it at the caller's handlers and
      // replay the state it already reached while probing.
      best.transport.adopt(handlers);
      resolve({ transport: best.transport, url: best.candidate.url });
    };

    /** True when nothing still in flight could beat what we already have. */
    const noBetterPossible = () =>
      !candidates.some(
        (c) =>
          c.priority < (best?.candidate.priority ?? Infinity) &&
          probes.has(c.url) &&
          !finished.has(c.url),
      );

    const onFailure = (candidate: Candidate) => {
      if (settled || finished.has(candidate.url)) {
        return;
      }
      finished.add(candidate.url);
      pending -= 1;
      if (best) {
        // A better-ranked candidate just died, so stop holding the winner back.
        if (noBetterPossible()) {
          commit();
        }

        return;
      }
      if (pending === 0) {
        settled = true;
        if (graceTimer) {
          clearTimeout(graceTimer);
        }
        reject(new Error("Couldn't reach this computer on any known address."));
      }
    };

    const onReady = (candidate: Candidate, transport: Transport) => {
      if (settled || finished.has(candidate.url)) {
        return;
      }
      finished.add(candidate.url);
      pending -= 1;

      // Keep whichever is simpler; drop the other immediately.
      if (!best || candidate.priority < best.candidate.priority) {
        best?.transport.disconnect();
        best = { transport, candidate };
      } else {
        transport.disconnect();
      }

      if (best.candidate.priority === 0 || noBetterPossible()) {
        commit();

        return;
      }
      graceTimer ??= setTimeout(commit, GRACE_MS);
    };

    for (const candidate of candidates) {
      const transport = new Transport(
        identity,
        {
          onState: (state) => {
            if (state === "ready") {
              onReady(candidate, transport);
            } else if (state === "offline") {
              onFailure(candidate);
            }
          },
          // Events arriving mid-probe are dropped; the caller resubscribes.
          onEvent: () => {},
        },
        candidate.url,
      );
      probes.set(candidate.url, transport);
      transport.connect();

      setTimeout(() => {
        if (!finished.has(candidate.url)) {
          transport.disconnect();
          onFailure(candidate);
        }
      }, PROBE_TIMEOUT_MS);
    }
  });
}
