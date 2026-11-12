/** The `request_signing.json` vector: requests a device member signs, as hosts do. */

import {
  requestSigningBytes,
  sha256Hex,
  signB64,
  toB64,
} from "@argus/remote-protocol";
import { phone } from "./fixtureChain";

const BASE = "/argus/account/v1";

const CASES = [
  { method: "GET", path_and_query: `${BASE}/log?epoch=0&after=-1`, body: "" },
  {
    method: "POST",
    path_and_query: `${BASE}/log`,
    body: '{"epoch":0,"entries":[]}',
  },
  {
    method: "post",
    path_and_query: `${BASE}/join/6f1c2a8e-0000-4000-8000-00000000abcd/deny`,
    body: "{}",
  },
  {
    method: "PUT",
    path_and_query: `${BASE}/push/registration`,
    body: '{"device_id":"00000000-0000-4000-8000-000000000001","name":"Café"}',
  },
];

export function requestSigningVector() {
  const ts = 1_800_000_000_000;

  return {
    member_id: phone.id,
    sign_pub: phone.sign_pub,
    cases: CASES.map((c, i) => {
      const message = requestSigningBytes(
        c.method,
        c.path_and_query,
        ts + i,
        c.body,
      );

      return {
        ...c,
        ts: ts + i,
        body_sha256: sha256Hex(c.body),
        message: toB64(message),
        sig: signB64(message, phone.sign_priv),
      };
    }),
  };
}
