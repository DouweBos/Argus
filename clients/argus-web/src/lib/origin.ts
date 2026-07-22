/**
 * The web client is served by Argus itself, so it always talks to the gateway
 * on its own origin — never a URL baked into the pairing code. This keeps it
 * working whether reached over the LAN IP or a tunnel hostname.
 */
export function wsOrigin(): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";

  return `${scheme}//${location.host}`;
}
