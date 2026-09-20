/**
 * Who a huddle guest is.
 *
 * Split deliberately across two stores, because two different questions are
 * being answered:
 *
 * - **The keypair** is what a grant binds to, and lives in `sessionStorage`,
 *   keyed by room token. Reloading the tab keeps it, so an approved guest is
 *   re-granted silently; closing the tab loses it, so coming back has to be
 *   approved again. It never reaches `localStorage` — a guest is not adopted
 *   hardware, and no grant outlives the tab that earned it.
 * - **The client id and name** are only an identity hint, grant nothing, and
 *   live in `localStorage`. They let the host see the person who stepped out
 *   and came back as the same row rather than a second one with the same name,
 *   and save them typing their name again.
 */

import { freshKeypair } from "./keystore";

const KEY_PREFIX = "argus.huddle.key.";
const LABEL_KEY = "argus.huddle.label";
const CLIENT_ID_KEY = "argus.huddle.client";

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

/**
 * This browser, across tabs and visits. Grants nothing on its own — it only
 * tells the host which row to update when someone rejoins.
 */
export function guestClientId(): string {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }
  const id = crypto.randomUUID();
  localStorage.setItem(CLIENT_ID_KEY, id);

  return id;
}

/** The name the host sees. Remembered so coming back doesn't ask again. */
export function readGuestLabel(): string {
  return localStorage.getItem(LABEL_KEY) ?? "";
}

export function rememberGuestLabel(label: string): void {
  localStorage.setItem(LABEL_KEY, label);
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
