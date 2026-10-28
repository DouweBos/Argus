/**
 * Writing log entries. A body is serialized once and that exact string is
 * signed and stored, so no canonical JSON is ever needed.
 */

import type { LogState } from "./log";
import type { AccountMember, LogEntry } from "./schema";
import { entrySigningBytes, proofSigningBytes, signB64, toB64 } from "./sign";

export interface EntrySigner {
  id: string;
  /** Ed25519 secret key, base64. */
  priv: string;
}

/** Type-specific fields of a body; the common header is filled in here. */
export type EntryFields = Record<string, unknown> & { type: string };

export interface EntryHeader {
  account_id: string;
  epoch: number;
  head: { seq: number; hash: string } | null;
  ts?: number;
}

/**
 * A signer whose private key never leaves its keystore (a non-extractable
 * WebCrypto key): it signs bytes and hands back the raw 64-byte signature.
 */
export interface AsyncEntrySigner {
  id: string;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
}

function entryBody(
  header: EntryHeader,
  signerId: string,
  fields: EntryFields,
): string {
  return JSON.stringify({
    v: 1,
    account_id: header.account_id,
    epoch: header.epoch,
    seq: header.head ? header.head.seq + 1 : 0,
    prev: header.head ? header.head.hash : "",
    ts: header.ts ?? Date.now(),
    signer: signerId,
    ...fields,
  });
}

/** Sign one entry that extends `head` (`null` for genesis). */
export function makeEntry(
  header: EntryHeader,
  signer: EntrySigner,
  fields: EntryFields,
): LogEntry {
  const body = entryBody(header, signer.id, fields);

  return {
    body,
    sigs: { [signer.id]: signB64(entrySigningBytes(body), signer.priv) },
  };
}

/** {@link makeEntry} for a key that signs asynchronously. */
export async function makeEntryWith(
  header: EntryHeader,
  signer: AsyncEntrySigner,
  fields: EntryFields,
): Promise<LogEntry> {
  const body = entryBody(header, signer.id, fields);
  const sig = await signer.sign(entrySigningBytes(body));

  return { body, sigs: { [signer.id]: toB64(sig) } };
}

/** A member's own key vouching for its id and keys. */
export function makeProof(member: AccountMember, signPriv: string): string {
  return signB64(proofSigningBytes(member), signPriv);
}

/** {@link makeProof} for a key that signs asynchronously. */
export async function makeProofWith(
  member: AccountMember,
  sign: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  return toB64(await sign(proofSigningBytes(member)));
}

/** The head a new entry must extend. */
export function headOf(state: LogState): { seq: number; hash: string } {
  return { ...state.head };
}
