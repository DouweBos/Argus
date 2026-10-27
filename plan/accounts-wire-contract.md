# Argus account layer — phase 1 wire contract (authoritative for all implementers)

Design background: /Users/douwe/Work/Houwert/Projects/Argus/plan/accounts.md. Where this file and
the plan disagree, THIS file wins (it resolves details the plan left open).

## Encodings

- All keys and signatures: standard base64 WITH padding (`Buffer.toString("base64")`,
  Swift `base64EncodedString()`). Ed25519 public keys raw 32 bytes, signatures 64 bytes.
  X25519 public keys raw 32 bytes.
- Hashes: lowercase hex SHA-256.
- Timestamps: integer milliseconds since epoch.
- Member ids and request ids: lowercase UUID v4 strings. `account_id`: 26-char lowercase
  base32 (RFC4648 alphabet lowercased, no padding) of 16 random bytes.
- `user_code`: `XXXX-XXXX` from alphabet `BCDFGHJKLMNPQRSTVWXZ` (20 letters). Input is
  normalized: uppercase, strip everything not in the alphabet, re-insert the dash after 4.

## Log entries

```
Entry = { body: string, sigs: { [signer_id]: base64 } }
```

`body` is the exact UTF-8 JSON string that was signed. Verifiers verify the signature over the
string first, then `JSON.parse` it. Never re-serialize a body.

Signature: `Ed25519(sign_priv, utf8("argus-account-v1\n" + body))`.
`entry_hash = sha256hex(utf8(body))`.

Common body fields: `{ v: 1, account_id, epoch, seq, prev, ts, type, signer }`
(`prev` = entry_hash of previous entry, `""` for seq 0; `signer` = member id that signs; the
signature lives in `sigs[signer]`. Extra keys in `sigs` are ignored.)

Members:

```
DeviceMember = { id, role: "device", kind: "ios" | "mac" | "electron", sign_pub, noise_pub, name, created_at }
HostMember   = { id, role: "host", platform: "darwin" | "linux", sign_pub, noise_pub, name, created_at }
```

`name`: 1–64 chars, no control characters (U+0000–U+001F, U+007F).

Proof of possession (a member's key signs its own identity):
`proof = Ed25519(member_sign_priv, utf8("argus-account-proof-v1\n" + id + "\n" + role + "\n" + sign_pub + "\n" + noise_pub))`.

Entry types (type-specific body fields):

| type         | fields                                                 | signer must be                                        | rules                                                                                                                                    |
| ------------ | ------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `genesis`    | `member`                                               | `member.id`                                           | seq 0, prev "". Signed by member.sign_pub.                                                                                               |
| `add_device` | `member: DeviceMember, request_id, sas_commit, proof`  | live member (device or host)                          | `proof` verifies against member.sign_pub. member.id and member.sign_pub never seen before in this epoch.                                 |
| `add_host`   | `member: HostMember, request_id, sas_commit, proof`    | live member (device or host)                          | same as add_device                                                                                                                       |
| `revoke`     | `member_id, reason: "removed" \| "lost" \| "unlinked"` | any live device; a host only when member_id == signer | target exists and is live                                                                                                                |
| `rotate`     | `member_id, sign_pub, noise_pub, proof`                | member_id itself (OLD key signs body)                 | target live; `proof` is the proof message over (member_id, role, NEW sign_pub, NEW noise_pub) signed by the NEW key; new sign_pub unused |
| `rename`     | `member_id, name`                                      | any live device, or the member itself                 | target live                                                                                                                              |

`request_id` is `""` and `sas_commit` is `""` for local links (Mac app linking its bundled host,
a host adding its own Electron device). Otherwise `request_id` is the link/join request id and
`sas_commit` is the hex sha256 of the SAS transcript.

Verifier (TS `packages/remote-protocol/src/account/log.ts`, Swift `ArgusKit/Account/AccountLog.swift`):

- Input: optional pinned root `{account_id, epoch, genesis_hash}`, optional prior state, entries.
- Per entry in order: signature over body by sigs[signer] using the signer's CURRENT sign_pub
  (genesis: member.sign_pub) → else `bad_signature` (missing sig too); parse + structural checks
  → else `malformed`; account_id/epoch match the pin (or genesis) and seq == head.seq+1 and
  prev == head.hash → else `fork`; signer exists, is live, and is allowed for the type → else
  `unknown_signer`; type rules → else `malformed`.
- A pinned genesis_hash that differs from entry 0's hash → `fork`.
- Output: `{ ok: true, state }` or `{ ok: false, reason, index, state /* last good */ }`.
- State: `{ account_id, epoch, genesis_hash, head: {seq, hash}, members: {[id]: {member, live, added_by_request: request_id, sas_commit}} }`.
- Safety code: first 12 hex chars of genesis_hash, upper-cased, grouped `XXXX-XXXX-XXXX`.

Golden fixtures: `packages/remote-protocol/src/account/fixtures/*.json`, each
`{ name, pin?: {...}, entries: Entry[], expect: { ok: true, head_seq, live_members: [ids] } | { ok: false, reason, index } }`
plus `keys.json` with the test seeds. Swift tests read them by relative path.

## SAS

```
field(b)   = u32be(len(b)) ‖ b
transcript = field(utf8("argus-account-sas-v1")) ‖ field(utf8(account_id)) ‖ field(u32be(epoch))
           ‖ field(hexdecode(head_hash)) ‖ field(b64decode(approver_sign_pub))
           ‖ field(b64decode(subject_sign_pub)) ‖ field(b64decode(subject_noise_pub))
           ‖ field(utf8(request_id))
digest     = sha256(transcript)
sas        = pad6( u32be(sha256(digest)[0..4]) mod 1_000_000 )   // = existing deriveSas(digest)
sas_commit = hex(digest)
```

For a host link the subject keys are the HOST member's keys (an Electron device riding along is not
part of the transcript). head*hash is the head at `POST /join/:id/approver` time; the approver's
add*\* entry MUST have `prev == head_hash` (i.e. seq == head.seq+1) — if the head moved, restart.

## Presence

`presence_body` = JSON string `{ v: 1, account_id, epoch, host_id, ts, endpoints: [{ kind: "lan"|"tailscale"|"cloudflare", url, priority }] }`.
`presence_sig = Ed25519(host_sign_priv, utf8("argus-account-presence-v1\n" + presence_body))`.
Clients verify against the host's sign_pub FROM THEIR VERIFIED LOG, require host_id/account_id/epoch
match and the host live, and drop records whose ts is older than the one already held.
Online = `last_seen` within 15 min.

## Host request signatures (host → service)

Headers: `x-argus-member: <member_id>` (once a member) OR `x-argus-key: <sign_pub b64>` (before),
`x-argus-ts: <ms>`, `x-argus-sig: base64(Ed25519(host_sign_priv, utf8("argus-account-req-v1\n" +
METHOD + "\n" + path + "\n" + ts + "\n" + sha256hex(body_bytes))))`, where `path` is the URL path
plus query exactly as sent (e.g. `/argus/account/v1/log?epoch=0&after=3`) and body_bytes is the raw
request body (empty for GET → sha256 of empty). Window ±5 min. The service accepts `x-argus-member`
only for a non-revoked member; `x-argus-key` matches a non-revoked member's sign_pub OR the
`subject_sign_pub` of a link request.

## Service API — base `https://houwert.dev/argus/account/v1`

Errors: `{ error: "<code>" }` with a fitting status (400 bad_request, 401 unauthorized,
403 forbidden, 404 not_found, 409 conflict, 410 expired, 422 invalid_entry, 429 rate_limited).
Clerk auth = `Authorization: Bearer <Clerk session JWT>`. JSON in and out.

| Method & path              | Auth                                                                                            | Request                                                                                  | Response                                                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /config`              | none                                                                                            | —                                                                                        | `{ clerk_publishable_key, frontend_api, min_client: { ios: "0", mac: "0", host: "0" } }`                                                                                                  |
| `POST /account`            | Clerk                                                                                           | `{}`                                                                                     | `{ account_id, epoch, head_seq: number \| null }` (create-or-get)                                                                                                                         |
| `GET /log?epoch=E&after=N` | Clerk, or host (member, or link-request subject once the request is claimed/approving/approved) | `after` default -1                                                                       | `{ epoch, entries: Entry[], next_after: number \| null }` (≤500/page)                                                                                                                     |
| `POST /log`                | Clerk, or host                                                                                  | `{ epoch, entries: Entry[] }`                                                            | `201 { head_seq }` / `409 { error: "conflict", head_seq }` / `422 { error: "invalid_entry", index, reason }`                                                                              |
| `GET /directory`           | Clerk, or host member                                                                           | —                                                                                        | `{ hosts: [{ host_id, presence_body, presence_sig, last_seen }] }` (live hosts with presence)                                                                                             |
| `PUT /host/presence`       | host member                                                                                     | `{ presence_body, presence_sig }`                                                        | `204`                                                                                                                                                                                     |
| `POST /link/start`         | host key (`x-argus-key` == subject.host.sign_pub)                                               | `{ subject: { host: HostMember, device?: DeviceMember }, proofs: { [member_id]: b64 } }` | `{ request_id, user_code, verification_uri: "https://houwert.dev/argus/link", verification_uri_complete: "https://houwert.dev/argus/link?code=XXXX-XXXX", expires_in: 600, interval: 5 }` |
| `GET /link/:id`            | host key (subject)                                                                              | —                                                                                        | `RequestStatus`                                                                                                                                                                           |
| `DELETE /link/:id`         | host key (subject)                                                                              | —                                                                                        | `204` (status → denied)                                                                                                                                                                   |
| `POST /link/claim`         | Clerk                                                                                           | `{ user_code }`                                                                          | `{ request_id, kind: "host" \| "computer", subject: { host, device?, proofs }, account_empty: boolean }` (creates the account if needed; kind "computer" when a device rides along)       |
| `GET /join`                | Clerk, or host member                                                                           | —                                                                                        | `{ requests: [{ request_id, kind, subject, status, created_at, expires_at }] }` (this account's claimed/approving requests)                                                               |
| `GET /join/:id`            | Clerk                                                                                           | —                                                                                        | `RequestStatus`                                                                                                                                                                           |
| `POST /join/:id/approver`  | Clerk, or host member                                                                           | `{ approver_id }`                                                                        | `{ head: { seq, hash } }` (status → approving; approver must be a live member of the account; allowed again by the same approver)                                                         |
| `POST /join/:id/deny`      | Clerk, or host member                                                                           | `{}`                                                                                     | `204`                                                                                                                                                                                     |
| `POST /join`               | Clerk                                                                                           | `{ member: DeviceMember, proof }`                                                        | `{ request_id, expires_at }` (phase 2 clients; service may implement)                                                                                                                     |
| `DELETE /account`          | Clerk, reverified ≤10 min (`fva[0]` ≤ 10)                                                       | `{}`                                                                                     | `204`                                                                                                                                                                                     |

`RequestStatus = { status: "pending"|"claimed"|"approving"|"approved"|"denied"|"expired", account_empty?: boolean, account_id?, epoch?, approver?: { id, sign_pub }, head?: { seq, hash }, through_seq?: number }`.

Link state machine (service): `pending` (code issued) → `claimed` (POST /link/claim binds account_id) →
`approving` (POST /join/:id/approver) → `approved` (a POST /log batch containing add_host with this
request_id, or — for an empty account — a genesis written by the request's subject host) /
`denied` / `expired` (10 min after creation; approved requests never expire).

Empty-account host link: after claim with `account_empty: true`, the subject host (x-argus-key auth)
POSTs `/log` with `genesis` (member = its HostMember) and, for Electron, an `add_device` for its
window device (signer = host, request_id = the link request id, sas_commit "", proof = device proof).
The service accepts genesis from a host key only in that situation, then marks the request approved
with `through_seq`.

`POST /log` hygiene: seq == head+1 and prev == head entry*hash (else 409 conflict); signers live and
allowed; signatures valid; an add*\* with non-empty request_id requires that request in `approving`
with `approver_id == signer` and member.sign_pub == request subject's; then members + request status
are updated in the same `db.batch()`. Genesis via Clerk only when the account has no entries for the
current epoch.

## Host commands (catalog domain `account`, Argus host, all snake_case)

| command                     | tier  | params                                             | result                                                                 |
| --------------------------- | ----- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `account_get_status`        | admin | `{}`                                               | `AccountStatus`                                                        |
| `account_list_hosts`        | admin | `{}`                                               | `AccountHost[]`                                                        |
| `account_list_members`      | admin | `{}`                                               | `AccountMemberInfo[]`                                                  |
| `account_device_key`        | host  | `{}`                                               | `{ device_id, noise_priv, noise_pub } \| null` (Electron's own device) |
| `account_login_start`       | host  | `{ surface: "electron"\|"mac"\|"cli"\|"menubar" }` | `AccountLinkState`                                                     |
| `account_login_confirm`     | host  | `{ match: boolean }`                               | `AccountLinkState`                                                     |
| `account_login_cancel`      | host  | `{}`                                               | `AccountLinkState`                                                     |
| `account_logout`            | host  | `{}`                                               | `AccountStatus`                                                        |
| `account_link_local_begin`  | host  | `{}`                                               | `{ host: HostMember, proof: string }`                                  |
| `account_link_local_finish` | host  | `{ accountId, epoch, genesisHash }`                | `AccountStatus`                                                        |
| `account_list_requests`     | host  | `{}`                                               | `AccountJoinRequest[]`                                                 |
| `account_approve_join`      | host  | `{ requestId }`                                    | `AccountApprovalState`                                                 |
| `account_confirm_join`      | host  | `{ match: boolean }`                               | `AccountApprovalState`                                                 |
| `account_deny_join`         | host  | `{ requestId }`                                    | void                                                                   |
| `account_set_config`        | host  | `{ patch: AccountConfigPatch }`                    | `AccountStatus`                                                        |

Mac local link (§5.2b): app calls `account_link_local_begin` → builds + signs `add_host`
(request_id "", sas_commit "", proof from the host) with its device key → `POST /log` → calls
`account_link_local_finish { accountId, epoch, genesisHash }`; the host then fetches the log with
member auth, verifies from genesis against that pin, finds its own add_host, and pins.

Host events: `account:status` (AccountStatus), `account:link-state` (AccountLinkState),
`account:approval-state` (AccountApprovalState).

`AccountLinkState = { kind: "idle" } | { kind: "awaiting_claim", user_code, verification_uri, verification_uri_complete, expires_at }
 | { kind: "awaiting_first" /* account empty, confirm becoming first */ } | { kind: "awaiting_sas", sas, approver_name }
 | { kind: "awaiting_approval" /* host confirmed, waiting for approver */ } | { kind: "linked" } | { kind: "error", message }`
(`account_login_confirm {match:true}` answers both awaiting_first and awaiting_sas.)

Remote methods (gateway, dotted): `account.status` (monitor) → `{ linked, account_id_hash /* sha256hex(account_id) */, head_seq }`;
`account.request_link` (monitor) `{}` → `{ user_code }` — starts the host's code link (surface "paired")
so a QR-paired phone can then claim + approve that code exactly like a typed one.

## Verifier check order (exact — fixtures pin reason AND index)

Genesis (first entry when there is no prior state): parse body JSON + schema → `malformed`;
type != genesis → `fork`; sigs[body.signer] missing or not valid under member.sign_pub →
`bad_signature`; seq != 0 or prev != "" → `fork`; signer != member.id → `unknown_signer`;
pinned root present and (account_id, epoch, genesis_hash) differ → `fork`.

Every later entry: read `signer` from the body JSON (unparseable → `malformed`); signer id not a
known member (live or revoked) → `unknown_signer`; sigs[signer] missing or invalid under the
signer's CURRENT sign*pub → `bad_signature`; schema parse fails → `malformed`;
account_id/epoch differ from state, or seq != head.seq+1, or prev != head.hash → `fork`; signer
not live → `unknown_signer`; then per type: genesis → `fork`; add*\*: member id already known or
sign_pub already used by any member → `malformed`, proof invalid → `bad_signature`; revoke: host
signer revoking someone else → `unknown_signer`, target not live → `malformed`; rotate:
member_id != signer → `unknown_signer`, target not live or new sign_pub already used →
`malformed`, proof (role of the target, NEW keys) invalid under NEW sign_pub → `bad_signature`;
rename: host signer renaming someone else → `unknown_signer`, target not live → `malformed`.
Empty entry list with no prior state → `malformed` at index 0. Passing a prior state whose
genesis_hash differs from the pin → `fork` at index 0.

Schema details: body `v` must be 1; `epoch`/`seq` non-negative integers; member `name` 1–64 chars
without control chars; DeviceMember.kind ∈ ios|mac|electron; HostMember.platform ∈ darwin|linux;
unknown `type` → malformed. Extra unknown keys are allowed (ignored).

Admission check (subject side): member live AND its add\_\* request_id == expected AND sas_commit ==
expected.

TS implementation: /Users/douwe/Work/Houwert/Projects/Argus/packages/remote-protocol/src/account/
(schema.ts, sign.ts, sas.ts, log.ts, entries.ts). Fixtures (generated by
`pnpm gen:account-fixtures` from scripts/gen-account-fixtures.ts):
packages/remote-protocol/src/account/fixtures/\*.json — keys.json has the seeds (sign_priv is the
32-byte Ed25519 seed, base64), sas.json the SAS vector.
