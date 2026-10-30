/**
 * Does this URL actually come back to us?
 *
 * A published tunnel URL is not a reachable one. `tailscale funnel` prints the
 * node's `*.ts.net` name immediately — before the tailnet accepts it, and even
 * when the Mac isn't connected to the tailnet at all — and a Cloudflare quick
 * tunnel's hostname resolves a beat before its edge routes to it. Handing such
 * a URL to a huddle guest produces a link that simply never loads.
 *
 * So we fetch the gateway's health endpoint over the public address and require
 * our own nonce back: proof the request traversed the tunnel and hit *this*
 * process, not a relay error page or someone else's server.
 */

import { Resolver } from "node:dns/promises";
import { getGatewayNonce, HEALTH_PATH } from "./gatewayHealth";

/** One attempt's budget. Well over a healthy round trip, under a user's patience. */
const PROBE_TIMEOUT_MS = 5_000;
/** A tunnel that just came up often needs a moment for DNS/edge to catch up. */
const PROBE_RETRY_DELAYS_MS = [750, 1_500];
/**
 * A fresh quick tunnel: outlasts trycloudflare.com's 60s negative TTL, in case
 * a local resolver cached the name as missing anyway.
 */
export const QUICK_TUNNEL_RETRY_DELAYS_MS = [
  1_000, 2_000, 4_000, 8_000, 15_000, 30_000,
];
const PUBLIC_DNS_SERVERS = ["1.1.1.1", "1.0.0.1"];
const PUBLIC_DNS_TIMEOUT_MS = 30_000;
const PUBLIC_DNS_POLL_MS = 1_000;

function toHttp(url: string): string {
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

async function probeOnce(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(`${toHttp(url).replace(/\/$/, "")}${HEALTH_PATH}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "cache-control": "no-cache" },
      redirect: "error",
    });
    if (!res.ok) {
      return false;
    }
    const body = (await res.json()) as { nonce?: unknown };

    return body?.nonce === getGatewayNonce();
  } catch {
    return false;
  }
}

export interface ProbeOpts {
  timeoutMs?: number;
  /** Extra attempts after the first; defaults to two backed-off retries. */
  retryDelaysMs?: number[];
  /**
   * Hold the first probe until public DNS has the hostname, so the system
   * resolver isn't asked early and left caching it as nonexistent.
   */
  awaitPublicDns?: boolean;
}

/**
 * Polls public resolvers until `host` resolves. Gives up quietly when they
 * can't be reached (a network that blocks outside DNS), leaving it to the probe.
 */
export async function waitForPublicDns(
  host: string,
  opts: {
    timeoutMs?: number;
    pollMs?: number;
    resolver?: HostResolver;
  } = {},
): Promise<void> {
  const resolver = opts.resolver ?? publicResolver();
  const deadline = Date.now() + (opts.timeoutMs ?? PUBLIC_DNS_TIMEOUT_MS);
  while (Date.now() < deadline) {
    try {
      if ((await resolver.resolve4(host)).length > 0) {
        return;
      }
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOTFOUND" && code !== "ENODATA") {
        return;
      }
    }
    await new Promise((resolve) =>
      setTimeout(resolve, opts.pollMs ?? PUBLIC_DNS_POLL_MS),
    );
  }
}

interface HostResolver {
  resolve4: (host: string) => Promise<string[]>;
}

function publicResolver(): HostResolver {
  const resolver = new Resolver({ timeout: 2_000, tries: 1 });
  resolver.setServers(PUBLIC_DNS_SERVERS);

  return resolver;
}

/**
 * True when the gateway answers on `url` from the public internet. Retries a
 * couple of times so a tunnel that is merely slow to propagate isn't written
 * off as broken.
 */
export async function probeGatewayUrl(
  url: string,
  opts: ProbeOpts = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const delays = opts.retryDelaysMs ?? PROBE_RETRY_DELAYS_MS;
  if (opts.awaitPublicDns) {
    await waitForPublicDns(new URL(toHttp(url)).hostname);
  }
  if (await probeOnce(url, timeoutMs)) {
    return true;
  }
  for (const delay of delays) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (await probeOnce(url, timeoutMs)) {
      return true;
    }
  }

  return false;
}
