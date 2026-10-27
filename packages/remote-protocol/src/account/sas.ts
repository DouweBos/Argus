/**
 * The 6-digit code both sides of an account approval compare. It binds the
 * approver, the subject's keys and the log head, so a swapped key or a fork
 * shown to either side gives a different code.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { SAS_DIGITS } from "../pairing";
import { fromB64 } from "./sign";

const SAS_LABEL = "argus-account-sas-v1";

export interface SasInput {
  account_id: string;
  epoch: number;
  head_hash: string;
  approver_sign_pub: string;
  subject_sign_pub: string;
  subject_noise_pub: string;
  request_id: string;
}

function u32be(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n >>> 0, false);

  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

const field = (bytes: Uint8Array): Uint8Array[] => [u32be(bytes.length), bytes];

export function sasTranscript(input: SasInput): Uint8Array {
  return concat([
    ...field(utf8ToBytes(SAS_LABEL)),
    ...field(utf8ToBytes(input.account_id)),
    ...field(u32be(input.epoch)),
    ...field(hexToBytes(input.head_hash)),
    ...field(fromB64(input.approver_sign_pub)),
    ...field(fromB64(input.subject_sign_pub)),
    ...field(fromB64(input.subject_noise_pub)),
    ...field(utf8ToBytes(input.request_id)),
  ]);
}

/** Same reduction as pairing's `deriveSas`, over the transcript digest. */
export function sasFromDigest(digest: Uint8Array): string {
  const hashed = sha256(digest);
  const view = new DataView(hashed.buffer, hashed.byteOffset, 4);

  return (view.getUint32(0, false) % 10 ** SAS_DIGITS)
    .toString()
    .padStart(SAS_DIGITS, "0");
}

export interface AccountSas {
  sas: string;
  /** Written into the `add_*` entry so the subject can check what it confirmed. */
  commit: string;
}

export function accountSas(input: SasInput): AccountSas {
  const digest = sha256(sasTranscript(input));

  return { sas: sasFromDigest(digest), commit: bytesToHex(digest) };
}
