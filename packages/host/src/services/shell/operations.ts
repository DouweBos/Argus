/**
 * Shell operations — reveal, open and browse, routed through `HostPlatform`
 * so the core stays Electron-free.
 */

import { hostPlatform } from "@argus/host/platform";

/** Open the system file manager with the given path selected. */
export function revealInFinder(fullPath: string): void {
  hostPlatform().revealInFinder(fullPath);
}

/** Open a file/path with the system's default handler. */
export async function openPath(fullPath: string): Promise<void> {
  const err = await hostPlatform().openPath(fullPath);
  if (err) {
    throw err;
  }
}

/** Open an http/https URL in the user's default browser. */
export function openExternalUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) {
    throw `Refusing to open non-http(s) URL: ${url}`;
  }
  hostPlatform()
    .openExternal(url)
    .catch(() => undefined);
}
