/**
 * Deterministic keys and a chain builder for the account log fixtures
 * (`fixtureBuilder.ts`, `fixtureJoins.ts`).
 */

import type { AccountMember, LogEntry } from "@argus/remote-protocol";
import { entryHash, makeEntry, toB64 } from "@argus/remote-protocol";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";

export interface Keys {
  id: string;
  sign_priv: string;
  sign_pub: string;
  noise_pub: string;
}

export function keys(id: string, fill: number): Keys {
  const seed = new Uint8Array(32).fill(fill);
  const noise = new Uint8Array(32).fill(fill + 100);

  return {
    id,
    sign_priv: toB64(seed),
    sign_pub: toB64(ed25519.getPublicKey(seed)),
    noise_pub: toB64(x25519.getPublicKey(noise)),
  };
}

export const ACCOUNT = "abcdefghijklmnopqrstuvwxyz";
export const TS = 1_800_000_000_000;

export const phone = keys("00000000-0000-4000-8000-000000000001", 1);
export const mini = keys("00000000-0000-4000-8000-000000000002", 2);
export const mac = keys("00000000-0000-4000-8000-000000000003", 3);
export const electron = keys("00000000-0000-4000-8000-000000000004", 4);
export const stranger = keys("00000000-0000-4000-8000-000000000005", 5);
export const phoneNext = keys(phone.id, 6);

export const device = (k: Keys, name: string, kind = "ios"): AccountMember =>
  ({
    id: k.id,
    role: "device",
    kind,
    sign_pub: k.sign_pub,
    noise_pub: k.noise_pub,
    name,
    created_at: TS,
  }) as AccountMember;

export const host = (k: Keys, name: string): AccountMember => ({
  id: k.id,
  role: "host",
  platform: "darwin",
  sign_pub: k.sign_pub,
  noise_pub: k.noise_pub,
  name,
  created_at: TS,
});

export const signer = (k: Keys) => ({ id: k.id, priv: k.sign_priv });

/** Builds a chain one entry at a time, always on the previous entry's hash. */
export class Chain {
  entries: LogEntry[] = [];
  constructor(
    readonly accountId = ACCOUNT,
    readonly epoch = 0,
  ) {}

  private head() {
    const last = this.entries.at(-1);
    if (!last) {
      return null;
    }

    return { seq: this.entries.length - 1, hash: entryHash(last.body) };
  }

  add(by: Keys, fields: Record<string, unknown> & { type: string }): this {
    this.entries.push(
      makeEntry(
        {
          account_id: this.accountId,
          epoch: this.epoch,
          head: this.head(),
          ts: TS + this.entries.length,
        },
        signer(by),
        fields,
      ),
    );

    return this;
  }

  headHash(): string {
    return entryHash(this.entries.at(-1)!.body);
  }
}
