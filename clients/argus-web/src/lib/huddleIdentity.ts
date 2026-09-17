/**
 * Who a huddle guest is, for as long as the tab is open.
 *
 * The keypair is ephemeral and lives in `sessionStorage`, keyed by room token:
 * reloading the tab keeps it, so an approved guest is re-granted silently,
 * while a new visit generates a new key and has to be let in again. It never
 * touches `localStorage` — a guest is not adopted hardware, and nothing here
 * outlives the huddle.
 */

import { freshKeypair } from "./keystore";

const KEY_PREFIX = "argus.huddle.key.";
const LABEL_KEY = "argus.huddle.label";

/** The room token in `#/huddle/<token>`, or null for any other route. */
export function parseHuddleToken(hash: string): string | null {
  const match = /^#\/huddle\/([^/?#]+)/.exec(hash);

  return match ? decodeURIComponent(match[1]) : null;
}

export interface GuestKeypair {
  privB64: string;
  pubB64: string;
}

/** This visit's key for one room — generated once, then reused on reload. */
export function guestKeypair(token: string): GuestKeypair {
  const storageKey = `${KEY_PREFIX}${token}`;
  const raw = sessionStorage.getItem(storageKey);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as GuestKeypair;
      if (parsed.privB64 && parsed.pubB64) {
        return parsed;
      }
    } catch {
      // Corrupt entry — fall through and mint a new key.
    }
  }
  const { privB64, pubB64 } = freshKeypair();
  const keypair: GuestKeypair = { privB64, pubB64 };
  sessionStorage.setItem(storageKey, JSON.stringify(keypair));

  return keypair;
}

/** The name the host sees. Remembered so a reload doesn't ask again. */
export function readGuestLabel(): string {
  return sessionStorage.getItem(LABEL_KEY) ?? "";
}

export function rememberGuestLabel(label: string): void {
  sessionStorage.setItem(LABEL_KEY, label);
}

/**
 * The host's static public key. A guest has no pairing to learn it from, so
 * the gateway publishes it on its own origin while a room is open.
 */
export async function fetchHostKey(): Promise<string> {
  const res = await fetch(`${location.origin}/huddle/host-key`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error("no huddle");
  }
  const { ds_pub } = (await res.json()) as { ds_pub?: string };
  if (!ds_pub) {
    throw new Error("no huddle");
  }

  return ds_pub;
}
