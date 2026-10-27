/** The network seam for EAS: Expo's API and serve-sim, swapped for fakes in tests. */

import WebSocket from "ws";

export type FetchFn = typeof fetch;

export type OpenSocket = (
  url: string,
  options: { headers: Record<string, string>; protocols: string[] },
) => WebSocket;

let fetchImpl: FetchFn | null = null;
let socketImpl: OpenSocket | null = null;

export function easFetch(input: string, init?: RequestInit): Promise<Response> {
  return (fetchImpl ?? fetch)(input, init);
}

export function easSocket(
  url: string,
  options: { headers: Record<string, string>; protocols: string[] },
): WebSocket {
  if (socketImpl) {
    return socketImpl(url, options);
  }

  return new WebSocket(url, options.protocols, { headers: options.headers });
}

export function setEasNetworkForTests(
  net: { fetch?: FetchFn; socket?: OpenSocket } | null,
): void {
  fetchImpl = net?.fetch ?? null;
  socketImpl = net?.socket ?? null;
}
