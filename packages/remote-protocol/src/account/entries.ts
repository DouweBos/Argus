/**
 * Writing log entries. A body is serialized once and that exact string is
 * signed and stored, so no canonical JSON is ever needed.
 */

import type { LogState } from "./log";
import type { AccountMember, LogEntry } from "./schema";
import { entrySigningBytes, proofSigningBytes, signB64 } from "./sign";

export interface EntrySigner {
  id: string;
  /** Ed25519 secret key, base64. */
  priv: string;
}

/** Type-specific fields of a body; the common header is filled in here. */
export type EntryFields = Record<string, unknown> & { type: string };

/** Sign one entry that extends `head` (`null` for genesis). */
export function makeEntry(
  header: {
    account_id: string;
    epoch: number;
    head: { seq: number; hash: string } | null;
    ts?: number;
  },
  signer: EntrySigner,
  fields: EntryFields,
): LogEntry {
  const body = JSON.stringify({
    v: 1,
    account_id: header.account_id,
    epoch: header.epoch,
    seq: header.head ? header.head.seq + 1 : 0,
    prev: header.head ? header.head.hash : "",
    ts: header.ts ?? Date.now(),
    signer: signer.id,
    ...fields,
  });

  return {
    body,
    sigs: { [signer.id]: signB64(entrySigningBytes(body), signer.priv) },
  };
}

/** A member's own key vouching for its id and keys. */
export function makeProof(member: AccountMember, signPriv: string): string {
  return signB64(proofSigningBytes(member), signPriv);
}

/** The head a new entry must extend. */
export function headOf(state: LogState): { seq: number; hash: string } {
  return { ...state.head };
}
