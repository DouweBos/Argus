# Account layer: find and link your computers

Status: phases 1–4 built (phase 2 minus identity merge, account reset and QR "Also add to
account" — see §11; phase 4 waits on the Cloudflare token below). Owner: Douwe. Touches `packages/host`, `packages/remote-protocol`,
`clients/apple`, `app/`, and the houwert.dev Pages project.

## What Douwe needs to do

Everything not on this list is ours to build and script. Nothing here needs the Clerk **secret** key.

**Clerk** (dashboard.clerk.com)

1. Create an application named **Argus**. Sign-in options: **Email → verification code** on,
   **Password** off. Social: **GitHub** and **Apple** on.
2. Deploy it to **Production** on domain `houwert.dev`. Clerk lists about five DNS records
   (`clerk.`, `accounts.`, `clkmail.`, `clk._domainkey`, `clk2._domainkey`). Add them in
   Cloudflare DNS as **DNS only** (grey cloud), then wait until Clerk shows them verified and SSL issued.
3. **GitHub**: at github.com/settings/developers → _New OAuth App_ (homepage `https://houwert.dev`,
   callback URL = the one Clerk's GitHub setting shows). Paste the client ID and secret into Clerk.
   (Production instances can't use Clerk's shared GitHub credentials.)
4. **Native applications**: turn on **Native API**, then add two Apple apps, both with
   Team ID `CKZT75PN5T`: `dev.houwert.argus.remote` (iOS) and `dev.houwert.argus.mac` (Mac).
   Native Sign in with Apple only needs Team ID + bundle ID. No Services ID or `.p8` is needed
   unless Clerk's production Apple toggle asks for one (see open question 2).
5. Copy the **Publishable key** (`pk_live_…`) and hand it over. It goes in one place,
   `houwert.dev/wrangler.toml` `[vars]`, and every client fetches it at runtime.

**Cloudflare**

6. Create the database: run `pnpm argus-account:setup` in houwert.dev (we write it; it runs
   `wrangler d1 create argus-account`, writes the id into `wrangler.toml`, and applies migrations;
   it needs the `wrangler` login you already deploy with). Or create a D1 database named
   `argus-account` in the dashboard and paste its id.
7. Optional: one WAF rate-limiting rule on `houwert.dev/argus/account/v1/link/*` (10 req/min per IP).
   The service has its own D1 counters either way.
   7a. **Managed tunnels (phase 4).** Create an API token (My Profile → API Tokens → Create Custom
   Token) with exactly **Account › Cloudflare Tunnel › Edit** and **Zone › DNS › Edit**, zone resource
   limited to `houwert.dev`. Then in houwert.dev: `wrangler pages secret put CF_TUNNEL_API_TOKEN
--project-name=houwert-dev`, and fill `CF_TUNNEL_ACCOUNT_ID` (dashboard → any zone → Overview →
   Account ID) and `CF_TUNNEL_ZONE_ID` (the `houwert.dev` zone's Zone ID) in `wrangler.toml`
   `[vars]`. Apply the migration before the deploy that uses it:
   `wrangler d1 migrations apply argus-account --remote`, then push `main`. Until all three are set the
   feature stays off and linked hosts use LAN and Tailscale only. Universal SSL already covers
   `argus-<hash>.houwert.dev` (one label deep); don't move them under a sub-subdomain.

**Apple Developer**

8. Enable the **Sign in with Apple** capability on both App IDs above (Xcode automatic signing does this
   for the iOS app; the Mac Developer ID profile needs regenerating).

---

## 1. Goals and non-goals

**Goals**

- Sign in once on a new iPhone, Mac app or Electron install. Your Argus hosts show up with their current
  addresses, and you can connect without scanning a QR per host.
- The account service is a **directory and introducer only**. It never authorizes a session, never
  holds a private key, and never sees traffic. A fully compromised service can withhold or delay
  things, but it cannot add a device, swap a host key, or read a byte.
- Every host and device keeps its own keys. The service stores public keys and signed statements.
- The first device on an account is trusted on first use (TOFU). Every later device is approved
  from a device or host that's already trusted, by comparing a 6-digit code.
- The directory carries each host's current endpoints and last-seen time. This fixes the
  "quick tunnel URL changed on restart, re-pair" problem.
- Keep what works: Noise IK end to end, LAN-first endpoint ranking, QR pairing as the no-account
  path, and per-device push sealing. Phase 4 replaced user-owned tunnels (cloudflared quick/token,
  Tailscale Funnel) with a managed tunnel per linked host plus direct tailnet addresses.

**Non-goals (for this plan)**

- Proxying traffic through houwert.dev. Clients still dial the host's own endpoints.
- Sharing hosts across accounts or teams. Huddles cover ad-hoc sharing.
- An account sign-in for the LAN web client (`clients/argus-web`). It stays QR-paired; see phase 5.
- Storing anything a host or agent produces. The service never sees prompts, names of projects or
  sessions, or paths.
- Replacing Clerk sessions with our own tokens. Clerk gates _who may use the directory_; our keys
  gate _who may connect_.

## 2. Today (what this builds on)

| Piece          | Where                                                                                                                                   | Relevant behaviour                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host identity  | `packages/host/src/services/remote/deviceStore.ts`                                                                                      | One X25519 static key (`ds_priv`/`ds_pub`) in the encrypted `~/.argus/remote-devices.json`. `rotateDesktopIdentity()` wipes every device.                                     |
| Paired devices | same                                                                                                                                    | `PairedDevice { device_id, dev_static_pub, capabilities, push }`, matched by `findDeviceByStaticKey`.                                                                         |
| Enrollment     | `pairing.ts`, `serverPairing.ts`, `bin/consolePairing.ts`                                                                               | Noise IKpsk1 on `/pair`. The PSK comes from the QR secret; a SAS (`derive.ts deriveSas`) is confirmed at the host console.                                                    |
| Steady state   | `localGatewayServer.ts handleDeviceSocket`                                                                                              | Noise IK on `/device`. An unknown key is closed unless a huddle room is open.                                                                                                 |
| Endpoints      | `endpoints.ts getEndpoints`, `managedTunnel.ts`, `tunnelManager.ts` (legacy + huddle quick tunnel)                                      | Ranked list (lan 0, tailscale = tailnet IP 1, cloudflare = managed tunnel 2), synced to clients via `host.endpoints`.                                                         |
| Tiers          | `remote-protocol/src/capabilities.ts`                                                                                                   | `monitor`/`control`/`admin`. `HOST_ONLY_COMMANDS` (pairing, revoke, grants, huddles) never cross the wire.                                                                    |
| Push           | `push/relay.ts`, `push/seal.ts`, houwert.dev `functions/argus/push/[[path]].ts` (KV `ARGUS_PUSH`)                                       | The device mints `push_key` (AES, sealing) and `auth_key` (HMAC), registers `auth_key` with the relay, and hands both to each host over the gateway (`device.register_push`). |
| iOS store      | `ArgusKit/Storage/Keystore.swift`, `DeviceIdentity.swift`                                                                               | Keychain `PairedHosts`. **One keypair per pairing**, plus pinned `desktopPubB64`, `url`, `endpoints`.                                                                         |
| Mac app        | `ArgusCore/Hosts/RemoteHostsStore.swift`, `PairedHostsFile.swift`, `ArgusDesktop/Settings/Hosts/HostsSettingsTab.swift`                 | Same `DeviceIdentity` records in a 0600 file.                                                                                                                                 |
| Electron       | `app/stores/settingsStore.ts RemoteHost`, `app/lib/transport/registry.ts`, `SettingsDialog/HostsSection.tsx`, `RemoteAccessSection.tsx` | Per-host keypair in renderer settings.                                                                                                                                        |

## 3. Threat model

| Adversary                                                    | Can                                                                                                                                                                                                                                                                                 | Cannot (by design)                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account service fully compromised (code + D1 + Clerk config) | Deny service; withhold or delay log entries (including revocations); show stale endpoints; learn metadata (who has how many hosts/devices, their names, IPs/tunnel URLs, last-seen); spam join requests; give a brand-new device a forked log on its very first sign-in (see below) | Add a device or host that any honest member accepts (no trusted signature); swap a host's Noise key (clients pin keys from signed log entries); read or alter traffic (Noise IK to pinned keys); read notifications (sealed per device) |
| Clerk account takeover (attacker signs in as you)            | Everything a compromised service can do _for your account_, including filing join requests                                                                                                                                                                                          | Get a request approved without someone confirming a code on a trusted device or host console                                                                                                                                            |
| Network attacker, tunnel provider (Cloudflare, Tailscale)    | See ciphertext and timing                                                                                                                                                                                                                                                           | Same as today: nothing else                                                                                                                                                                                                             |
| Stolen phone (unlocked)                                      | Act as that device until it's revoked                                                                                                                                                                                                                                               | Survive revocation: hosts drop it once they see the signed entry (gateway push, or polling within 5 min)                                                                                                                                |
| Compromised host                                             | Everything on that host; approve new devices from its console (by design, see §4.4)                                                                                                                                                                                                 | Read other hosts' traffic, or impersonate other hosts (separate keys)                                                                                                                                                                   |
| Someone holding a link code                                  | Bind a pending host link to _their_ account (an annoyance)                                                                                                                                                                                                                          | Get a host trusted by your devices without your SAS confirmation                                                                                                                                                                        |

Known residual risks, accepted for now:

- **Freeze.** A malicious service can hide a revocation from a host that only polls. Mitigation: the
  revoking device also pushes the signed entry to every host it can reach (`account.sync`), and the
  host console can revoke locally without the service.
- **Fork at first use.** A malicious service could tell a brand-new device "this account is empty" and
  let it create a second genesis, or show it a fork. Its approvals are bound to the log head by the SAS
  (§5.3), so a fork never connects to your real hosts. Every device shows the account's **safety
  code** (a hash of genesis) in Settings for a manual check.
- **Metadata.** Device and host names, and LAN IPs, are visible to the service. Open question 4 covers
  encrypting names; LAN endpoint publishing has a per-host off switch.

## 4. Identities and keys

### 4.1 Keys per member

| Member               | Signing key (Ed25519) | Noise static (X25519)                                                          | Stored in                                                                                                            |
| -------------------- | --------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Host                 | **new** `host_sign`   | existing `ds_priv`/`ds_pub` (unchanged)                                        | `remote-devices.json` encrypted blob, new `account` field                                                            |
| iOS / Mac app device | **new** `dev_sign`    | **new** account-wide `dev_noise`, one per install, used for every account host | Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, not synced)                                            |
| Electron install     | **new** `dev_sign`    | **new** `dev_noise`                                                            | Host's encrypted blob (the renderer reads it through a host-tier command, as it reads `RemoteHost.devPrivB64` today) |

Notes:

- QR-paired hosts keep their per-pairing keypairs. Only account-linked connections use `dev_noise`.
- Ed25519 is everywhere we need it: Node `crypto` (`ed25519`), CryptoKit `Curve25519.Signing`,
  Workers WebCrypto `Ed25519`, Safari 17+.
- The service authenticates hosts by `host_sign` request signatures. No bearer secret is ever
  issued to a host, so the service holds no signing secret of its own.

### 4.2 The account log

Each account has one **append-only, hash-chained, signed log**. It is the only thing anyone trusts. D1
tables derived from it are a convenience for the service, never for clients.

```
Entry = { body: string /* exact UTF-8 JSON as signed */, sigs: { [signer_id]: base64 } }
body  = { v: 1, account_id, epoch, seq, prev /* sha256 hex of previous body, "" for seq 0 */,
          ts, type, signer /* member id */, ...type fields }
sig   = Ed25519(sign_priv, "argus-account-v1\n" + body)
```

Signatures cover the exact `body` string, so no JSON canonicalization is needed in TS or Swift.
Verifiers check the signature first, then parse.

| `type`       | Fields                                                   | Signed by                                             | Valid when                                                   |
| ------------ | -------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| `genesis`    | `member: Member`                                         | the member itself                                     | `seq == 0`. Accepted on TOFU only (§5.1)                     |
| `add_device` | `member: DeviceMember`, `request_id`, `sas_commit`       | approver **and** the new device (proof of possession) | approver is a live device, or a live host (console approval) |
| `add_host`   | `member: HostMember`, `request_id`, `sas_commit`         | approver **and** the host                             | approver is a live device or host                            |
| `revoke`     | `member_id`, `reason: "removed" \| "lost" \| "unlinked"` | any live device; a host only for itself               | target exists and is live                                    |
| `rotate`     | `member_id`, `sign_pub`, `noise_pub`                     | old **and** new signing key                           | target live, signer == target                                |
| `rename`     | `member_id`, `name`                                      | any live device, or the member itself                 | target live                                                  |

```
DeviceMember = { id: uuid, role: "device", kind: "ios" | "mac" | "electron",
                 sign_pub, noise_pub, name, created_at }
HostMember   = { id: uuid, role: "host", platform: "darwin" | "linux",
                 sign_pub, noise_pub /* = ds_pub */, name, created_at }
sas_commit   = sha256(sas_transcript) hex   // §5.3. Lets the subject check the code it confirmed
```

Every verifier pins `(account_id, epoch, genesis_hash)` and keeps a verified head `(seq, hash)`. A
fetched entry whose `prev` doesn't match the head is a **fork**: stop applying updates, keep the last
good state, and report `account_log_rejected { reason: "fork" }`. The verifier is one pure module
mirrored in TS (`packages/remote-protocol/src/account/log.ts`) and Swift
(`ArgusKit/Account/AccountLog.swift`), checked against shared golden fixtures
(`packages/remote-protocol/src/account/fixtures/*.json`, which the Swift tests also read).

### 4.3 What a host trusts

A Noise IK initiator on `/device` is accepted if any of these hold, checked in order:

1. **Paired.** `findDeviceByStaticKey` hits. This is today's path, unchanged.
2. **Account.** The host is linked, and its verified log has a live `DeviceMember` with
   `noise_pub == clientPub`. The host materializes a `PairedDevice { source: "account" }` the first
   time, so grants, `last_seen`, push and the device list work unchanged.
3. **Huddle guest** while a room is open (unchanged).

Grants for account devices come from a host setting (§8). Defaults: `ios` → `control`;
`mac`/`electron` → `control` + `admin`. Per-device overrides use the existing
`remote_set_device_control`. A revoke entry removes the materialized record and calls
`disconnectDevice` (`gateway.ts`).

### 4.4 Who can approve

- Any live **device**: an app with UI.
- Any live **host, from its console only**: the Electron window, the Mac app's local host, or the
  `argus-host` terminal / Argus Server menu bar. This matches the rule that pairing is the root of
  trust and console-only. It is also the recovery path (§5.8).
- Approval is never reachable over the gateway. `account_approve_join` joins `HOST_ONLY_COMMANDS`.

## 5. Flows

Notation: **S** = account service (houwert.dev), **C** = Clerk, **D** = device, **H** = host.
All "show code" steps use the SAS of §5.3.

### 5.1 Sign up / first device (iOS or Mac app)

1. D fetches `GET /v1/config` → `{ clerk_publishable_key, frontend_api, min_client }`, then
   configures ClerkKit.
2. The user signs in natively: Sign in with Apple, GitHub (ASWebAuthenticationSession inside ClerkKit),
   or an email code.
3. D → S `POST /v1/account` (Clerk JWT). S creates or returns `{ account_id, epoch, head_seq }`.
4. `head_seq == null` (an empty account): D generates `dev_sign` + `dev_noise`, writes
   `genesis` (`POST /v1/log`, seq 0). S accepts only if seq 0 is still free (UNIQUE CAS).
5. D pins `(account_id, epoch, sha256(genesis.body))` and shows the safety code in Settings.
6. `head_seq != null`: go to §5.3 (join as a new device).

On the **Mac app**, step 4 also links the bundled local host in the same breath (§5.2b), so the
first sign-in on a Mac lists that Mac immediately.

### 5.2 Link a host

**a. From a browser or another device: `argus-host login`, Electron, or the Argus Server menu bar**

1. H generates `host_sign` if it has none. H → S `POST /v1/link/start`, signed with `host_sign`:
   `{ host: HostMember, device?: DeviceMember /* Electron: the window is also a device */,
proofs }` → `{ request_id, user_code: "WDJB-MJHT", verification_uri:
"https://houwert.dev/argus/link", verification_uri_complete: "…?code=WDJB-MJHT",
expires_in: 600, interval: 5 }`.
2. H prints or shows the code and URL. Electron opens `verification_uri_complete` through
   `HostPlatform.openExternal`.
3. The user claims the code in one of two places:
   - **An Argus app** (Settings → Computers → "Add a computer" → type the code). The app claims and
     approves in one step: skip to 5.
   - **The hosted page** `houwert.dev/argus/link`: Clerk sign-in (Clerk JS), confirm the code →
     `POST /v1/link/claim` binds the request to the account. The page then says: "Approve it on
     your phone or another computer" (or step 4).
4. **Empty account.** If the account has no log yet, H sees `status: "claimed", account_empty: true`
   on its next poll. The console asks "Make this computer the first on your account?" and H writes
   `genesis` with itself as the member (TOFU, same as §5.1). Electron also writes `add_device` for
   its window device, signed by the host.
5. **Otherwise** an approver A (a device app, or another host's console) opens the pending request →
   `POST /v1/join/:id/approver { approver_id }`. Both A and H now show the SAS. The user confirms on
   **both**: tap "Codes match" on A; type `y` / click Confirm on H.
6. A writes `add_host` (and `add_device` for Electron) in one `POST /v1/log` batch, signed by A and
   carrying H's proof signature from step 1.
7. H polls `GET /v1/link/:id` → `approved { epoch, through_seq }`, fetches the log, verifies it from
   genesis, checks that its own `add_host` has the `sas_commit` it confirmed, and pins the root.
   It then starts publishing presence (§5.5).

**b. The Mac app's own bundled host (local, no code)**

The Mac app talks to its host over `host.sock` as the machine owner, so this is console-equivalent.
The app calls host command `account_link_local { request }` with its device's signature already
applied. The host verifies, signs its proof, and the app appends `add_host`. No SAS: both ends are
the same user on the same machine over a 0600 socket.

**c. A host you already QR-paired with (migration)**

The phone sends `account.request_link` over the existing gateway. The host shows the same confirm
dialog as pairing (SAS from the log head plus both keys). On confirm, the phone writes `add_host`.

### 5.3 SAS (one definition for every approval)

```
transcript = "argus-account-sas-v1" ‖ account_id ‖ u32(epoch) ‖ head_hash
           ‖ approver.sign_pub ‖ subject.sign_pub ‖ subject.noise_pub ‖ request_id
sas        = deriveSas(sha256(transcript))      // reuse derive.ts / Derive.swift, 6 digits
sas_commit = hex(sha256(transcript))            // written into the add_* entry
```

The SAS binds the approver, the subject's keys, and the log head. A swapped key on either side, or a
fork shown to one side, gives a different code. The subject refuses to adopt the log unless its
`add_*` entry carries the `sas_commit` it confirmed.

### 5.4 Add a device (approval)

1. New device N signs in with Clerk (§5.1 steps 1–3). The account isn't empty, so N generates keys
   and calls `POST /v1/join { member: DeviceMember, proof }` → `{ request_id }`.
2. Trusted devices see the request: the pending banner in Settings → Devices, refreshed on
   foreground. Phase 3 adds a sealed silent push. Host consoles show it too.
3. Approver A opens it → `POST /v1/join/:id/approver`. N's poll returns A's `sign_pub` and the head,
   so both show the SAS.
4. The user confirms on both sides. A appends `add_device`. N verifies the log from genesis, checks
   `sas_commit`, and pins the root.
5. Hosts pick up the entry on their next poll, or immediately via §5.5's `account.sync` when A is
   connected to them. From then on, N's handshake to any account host succeeds (§4.3).

Requests expire after 10 minutes. `POST /v1/join/:id/deny` (any trusted device) or expiry closes them.

### 5.5 Connect, presence, and the directory

- **Presence.** A linked host signs `{ host_id, endpoints: RemoteEndpoint[], ts }` with `host_sign`
  and sends it with `PUT /v1/host/presence`. This happens on every `subscribeTunnelChange` or
  `setGatewayOnLan` change (debounced 2 s), and as a heartbeat every 5 min. `last_seen` is the
  service's receive time.
- **Directory.** A client calls `GET /v1/directory` → `[{ host_id, presence_body, presence_sig,
last_seen }]`. The client verifies `presence_sig` against the host's `sign_pub` _from its own
  verified log_ and drops records older than the one it holds. A forged record can only fail the
  Noise handshake, but verifying it also stops the service from steering phones at arbitrary LAN
  addresses.
- **Connect.** The client builds a `DeviceIdentity` from the log member (`desktopPubB64 = noise_pub`,
  `devPriv = dev_noise`) plus the verified endpoints, and races them with the existing
  `EndpointRacer`. Nothing changes from Noise onward.
- **Sync.** After the handshake, the client calls `account.sync { after_seq }` (remote method). It
  hands the host any entries newer than the host's head. The host verifies and applies them. This
  is how revocations beat a frozen service.
- **Offline.** No presence for 15 min shows "Offline · last seen 2 h ago". The client still tries the
  last good endpoints. A visible host list re-reads the directory every minute and on foreground,
  and recomputes online against the current time even when that read fails.

### 5.6 Revoke

- **Remove a device or host.** Any trusted device appends `revoke`. A host can only revoke itself
  ("Unlink this computer"). The revoking device pushes the entry over `account.sync` to every host
  it's connected to. Other hosts poll `GET /v1/host/log?after=` every 5 min and on every new
  connection.
- **Host applies a device revoke:** delete the materialized `PairedDevice`, `disconnectDevice`,
  `revokeViaRelay` for its push registration, and emit `devices` changed.
- **Host applies its own revoke:** unpin the account, delete `host_sign`, and stop presence. It keeps
  QR-paired devices.
- **Client applies a host revoke:** drop it from the list and `AgentHostIndex.forget(hostId:)`.
- **Local revoke** from the host console (existing `remote_revoke_device`) works without the
  service. For an account device it also appends `revoke` if the host can reach S, signed by the host
  as approver of last resort. Open question 6 covers whether hosts may revoke _other_ members.
- **Sign out on a device** = self-`revoke` + delete keys + Clerk sign-out. Hosts it was QR-paired with
  are unaffected.

### 5.7 Rotate

- **Device key rotation** (manual in Settings, or after a suspected leak): append `rotate` signed by
  the old and new keys. Hosts update their materialized record's `dev_static_pub` in place, so grants
  and push survive.
- **Host key rotation.** `rotateDesktopIdentity()` (`deviceStore.ts`) today wipes every device. On a
  linked host it also appends `rotate` (old + new `host_sign`, new `noise_pub`). Account devices
  re-read the log and keep working. QR-paired devices still need re-pairing, as today.
- **Epoch change** happens only through recovery (§5.8).

### 5.8 Recover

| You still have                                            | Do                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any trusted device                                        | Normal approval (§5.4)                                                                                                                                                                                                                                                                                                                                                 |
| No device, but a linked host you can sit at (or SSH into) | Sign in on the new device → join request → approve it **from that host's console** (`argus-host approve`, the Electron prompt, or the Mac app's local host). If the console isn't handy, **QR-pair** with that host first (today's flow). The pairing confirm screen then offers "Also add to your account", which writes `add_device` signed by the host.             |
| Nothing at all                                            | **Reset account trust**: the new device writes `genesis` for `epoch + 1` (S requires a fresh Clerk session with a reverification prompt, and emails the user). Old-epoch hosts **do not** follow automatically, because the service could forge a reset. Each host must be re-linked from its console (§5.2a). Re-linking drops that host's old-epoch account devices. |

### 5.9 Headless host login (`argus-host login`)

```
$ argus-host login
  Open https://houwert.dev/argus/link and enter  WDJB-MJHT   (expires in 10 min)
  Waiting…
  Approval requested by "Douwe's iPhone". Code on your phone: 482 093
  Does it match? [y/N] y
  Linked. This computer now shows up on your devices.
```

- These are console words in `bin/argus-host.ts`, next to `pair`: `login`, `logout`, `approve`,
  `account`. `argus-host login` is also a one-shot CLI form for SSH.
- The Argus Server menu bar drives the same state machine (`services/account/link.ts`), the way
  `serverPairing.ts` serves both today.
- The browser is only needed to _claim_ the code. Typing it into the phone app does claim and
  approve in one go.
- We run our own device-code endpoint, not Clerk's OAuth device grant. The latter is a beta feature
  enabled per account on request, and needs an OAuth app. Ours needs nothing in Clerk.

## 6. Account service (houwert.dev)

### 6.1 Layout

```
houwert.dev/
  wrangler.toml                         + [[d1_databases]] ARGUS_ACCOUNT, + [vars] CLERK_PUBLISHABLE_KEY
  migrations/argus-account/0001_init.sql
  functions/argus/account/v1/[[path]].ts router only
  server/argus-account/                 (outside functions/, so these files aren't routes)
    auth.ts        Clerk JWT verify (JWKS) + host request signatures
    log.ts         structural checks + Ed25519 verify (hygiene, not trust)
    links.ts       link/join state machine
    presence.ts    directory
    ratelimit.ts   D1 fixed-window counters
    push.ts        phase 3: registrations, host push keys, host-signed sends, wake-ups
  server/argus-push/providers.ts        APNs/FCM delivery, shared with functions/argus/push
  src/pages/ArgusLink.tsx               /argus/link: Clerk JS sign-in + code claim
  scripts/argus-account-setup.mjs       d1 create + id → wrangler.toml + migrations apply --remote
```

Follow houwert.dev conventions: Biome with tabs, Tailwind, the dark zinc/emerald look on `/argus/link`.

### 6.2 Storage: D1

| Option              | Verdict                                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KV (what push uses) | Eventually consistent (~60 s). A stale read of the log head breaks CAS appends and could resurrect a revoked member. **No.**                                                                                                  |
| Durable Objects     | Strongly consistent, but Pages Functions can't define them, only bind to one from a separate Worker. More deploy surface than we need.                                                                                        |
| **D1**              | Single primary, strongly consistent when read without the Sessions API. Can be bound to Pages directly, and supports SQL constraints for CAS (`PRIMARY KEY(account_id, epoch, seq)`). **Yes.** Don't enable read replication. |

### 6.3 Schema (`0001_init.sql`)

```sql
CREATE TABLE accounts (
  account_id     TEXT PRIMARY KEY,           -- random 128-bit, base32
  clerk_user_id  TEXT NOT NULL UNIQUE,       -- Clerk `sub`; no email stored
  epoch          INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

CREATE TABLE log_entries (
  account_id  TEXT NOT NULL,
  epoch       INTEGER NOT NULL,
  seq         INTEGER NOT NULL,
  body        TEXT NOT NULL,                 -- exact signed JSON
  sigs        TEXT NOT NULL,                 -- {signer_id: b64}
  entry_hash  TEXT NOT NULL,                 -- sha256(body) hex
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (account_id, epoch, seq)       -- the CAS
);

-- Derived from the log on append, for request auth and lookups only.
CREATE TABLE members (
  member_id   TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  epoch       INTEGER NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('device','host')),
  sign_pub    TEXT NOT NULL UNIQUE,
  noise_pub   TEXT NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX members_account ON members(account_id, epoch);

CREATE TABLE host_presence (
  host_id        TEXT PRIMARY KEY REFERENCES members(member_id),
  account_id     TEXT NOT NULL,
  presence_body  TEXT NOT NULL,              -- host-signed endpoints JSON
  presence_sig   TEXT NOT NULL,
  last_seen      INTEGER NOT NULL
);

-- Pending host links and device joins.
CREATE TABLE join_requests (
  request_id   TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('host','computer','device')),
  user_code    TEXT UNIQUE,                  -- host links only; NULL for app-initiated joins
  account_id   TEXT,                         -- NULL until claimed (host links)
  subject      TEXT NOT NULL,                -- members + proofs JSON
  subject_sign_pub TEXT NOT NULL,
  approver_id  TEXT,
  status       TEXT NOT NULL,                -- pending|claimed|approving|approved|denied|expired
  through_seq  INTEGER,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX join_account ON join_requests(account_id, status);

CREATE TABLE rate_limits (
  bucket   TEXT PRIMARY KEY,                 -- "<route>:<ip-hash|account|host>:<window>"
  count    INTEGER NOT NULL,
  expires  INTEGER NOT NULL
);

-- Phase 3 (migrations/argus-account/0002_push.sql)
CREATE TABLE push_registrations (
  device_id    TEXT PRIMARY KEY,
  account_id   TEXT NOT NULL,              -- for cleanup on account delete
  service      TEXT NOT NULL CHECK (service IN ('apns','fcm')),
  token        TEXT NOT NULL,
  environment  TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE TABLE push_keys (                     -- push_key sealed to one host's noise_pub
  device_id   TEXT NOT NULL,
  host_id     TEXT NOT NULL,
  sealed      TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (device_id, host_id)
);
```

A cron isn't available to Pages. Expired `join_requests` and `rate_limits` rows are swept
opportunistically: at most 50 rows deleted per request, on 1 % of requests.

### 6.4 Authentication

**Clerk (users).** `Authorization: Bearer <Clerk session JWT>`. The token comes from
`Clerk.shared.session?.getToken()` on Apple, or Clerk JS on `/argus/link`, and lives 60 s.

- The issuer comes from the publishable key: `pk_live_<base64("clerk.houwert.dev$")>` →
  `https://clerk.houwert.dev`. JWKS is at `${issuer}/.well-known/jwks.json`, cached in module scope
  and the Cache API for 1 h, and refetched on an unknown `kid`.
- Verify RS256 with WebCrypto. Check `iss`, `exp`/`nbf` (5 s leeway), and `sub`. Check `azp` only
  when present (browser tokens), and only against `https://houwert.dev`.
- **No Clerk secret key, no JWT template, no OAuth app.** The publishable key is the only Clerk
  value the service needs, so it can be a plain `[vars]` entry.

**Hosts.** These headers, over this message:

```
x-argus-member: <host_id>         (or x-argus-key: <sign_pub b64> before the host has an id)
x-argus-ts: <ms>
x-argus-sig: Ed25519(host_sign, "argus-account-req-v1\n" + METHOD + "\n" + path + "\n" + ts + "\n" + sha256hex(body))
```

The timestamp window is ±5 min. Mutations are idempotent, so replay inside the window is harmless.
S looks up `sign_pub` in `members` (not revoked) or in the pending `join_requests` row.

### 6.5 Endpoints (`/argus/account/v1`)

Every response is JSON. Errors look like `{ error: "<code>" }`.

| Method & path                         | Auth                        | Request                                                                          | Response                                                                                                           |
| ------------------------------------- | --------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /config`                         | none                        | —                                                                                | `{ clerk_publishable_key, frontend_api, min_client: { ios, mac, host } }`                                          |
| `POST /account`                       | Clerk                       | `{}`                                                                             | `{ account_id, epoch, head_seq: number \| null }` (create-or-get)                                                  |
| `GET /log?epoch&after`                | Clerk or host               | —                                                                                | `{ epoch, entries: Entry[] }` (≤ 500 per page, `next_after`)                                                       |
| `POST /log`                           | Clerk or host               | `{ epoch, entries: Entry[] }` (a batch, in seq order)                            | `201 { head_seq }` / `409 { error: "conflict", head_seq }` / `422 { error: "invalid_entry", index }`               |
| `GET /directory`                      | Clerk or host               | —                                                                                | `{ hosts: [{ host_id, presence_body, presence_sig, last_seen }] }`                                                 |
| `PUT /host/presence`                  | host                        | `{ presence_body, presence_sig }`                                                | `204`                                                                                                              |
| `POST /link/start`                    | host key (pre-member)       | `{ subject: { host, device? }, proofs }`                                         | `{ request_id, user_code, verification_uri, verification_uri_complete, expires_in: 600, interval: 5 }`             |
| `GET /link/:id`                       | host key                    | —                                                                                | `{ status, account_empty?, account_id?, epoch?, approver?: { id, sign_pub }, head?: { seq, hash }, through_seq? }` |
| `POST /link/claim`                    | Clerk                       | `{ user_code }`                                                                  | `{ request_id, kind, subject }`                                                                                    |
| `POST /join`                          | Clerk                       | `{ member: DeviceMember, proof }`                                                | `{ request_id, expires_at }`                                                                                       |
| `GET /join`                           | Clerk or host               | —                                                                                | `{ requests: [{ request_id, kind, subject, status, created_at }] }`                                                |
| `GET /join/:id`                       | Clerk                       | —                                                                                | same shape as `GET /link/:id`                                                                                      |
| `POST /join/:id/approver`             | Clerk or host               | `{ approver_id }`                                                                | `{ head: { seq, hash } }` (moves to `approving`)                                                                   |
| `POST /join/:id/deny`                 | Clerk or host               | `{}`                                                                             | `204`                                                                                                              |
| `POST /account/reset`                 | Clerk + reverified ≤ 10 min | `{ genesis: Entry }`                                                             | `{ epoch }`                                                                                                        |
| `DELETE /account`                     | Clerk + reverified          | `{}`                                                                             | `204` (deletes everything)                                                                                         |
| _phase 3_ `PUT /push/registration`    | Clerk                       | `{ device_id, service, token, environment, sealed_keys: { [host_id]: string } }` | `204` (no `auth_key`: account sends are authenticated by the host's signature)                                     |
| _phase 3_ `DELETE /push/registration` | Clerk                       | `{ device_id }`                                                                  | `204`                                                                                                              |
| _phase 3_ `GET /host/push-keys`       | host                        | —                                                                                | `{ devices: [{ device_id, service, environment, sealed }] }`                                                       |
| _phase 3_ `POST /push/send`           | host                        | `{ device_id, sealed, collapse_id? }`                                            | as the relay's `/send` (see the wire contract § Phase 3)                                                           |

What `POST /log` checks (hygiene only, clients re-verify everything):

- `seq == head + 1` and `prev == head.entry_hash`.
- Every signer is a live member, and the entry type is one that signer may write (§4.2 table).
- Signatures verify.
- An entry referencing a `request_id` requires that request to be `approving` with the same
  approver. Then it updates `members` and the request status in the same `db.batch()`.

### 6.6 Rate limits

| Bucket                                                                   | Limit                                                                                                    |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `link/start` per IP (sha256 with a daily salt; IPs are never stored raw) | 10 / 10 min                                                                                              |
| `link/claim` per account                                                 | 10 / 10 min. Per IP: 20 / 10 min. Codes are 8 chars from a 20-letter alphabet (~34 bits) and live 10 min |
| `join` per account                                                       | 5 pending at once, 20 / day                                                                              |
| `log` appends per account                                                | 60 / hour                                                                                                |
| `host/presence` per host                                                 | 1 / 30 s (ignored, 204, beyond that)                                                                     |
| Any Clerk-authed route per account                                       | 600 / 10 min                                                                                             |

### 6.7 Hosted page `/argus/link`

- A static SSR shell with Clerk JS loaded from `https://clerk.houwert.dev/npm/@clerk/clerk-js@5/dist/clerk.browser.js`
  using the key from `/config`. Signed out → `mountSignIn`. Signed in → a code field (pre-filled from
  `?code=`) → `POST /link/claim` → "Approve it on a device that's already signed in".
- If the account is empty, it says "Go back to your computer to finish". That computer becomes the first.
- No keys live in the browser, and the page can't approve anything. It only proves "this Clerk user
  claims this code".

## 7. Client changes (mapped to code)

### 7.1 Protocol: `packages/remote-protocol`

| Change                                                                                                                                                                                                                             | File                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Log, member, presence, and SAS-transcript zod schemas, plus the pure verifier                                                                                                                                                      | **new** `src/account/{schema,log,sas}.ts` + `fixtures/`                    |
| Host commands catalog (domain `account`)                                                                                                                                                                                           | **new** `src/commands/account.ts`; models in `src/models/account.ts`       |
| Remote methods `account.sync`, `account.request_link`, `account.status`                                                                                                                                                            | `src/messages.ts`; tiers in `src/capabilities.ts`; scope in `src/scope.ts` |
| `HOST_ONLY_COMMANDS` += `account_login_start`, `account_login_confirm`, `account_login_cancel`, `account_logout`, `account_approve_join`, `account_deny_join`, `account_revoke_member`, `account_link_local`, `account_set_config` | `src/capabilities.ts`                                                      |
| `PairedDevice` model gains `source: "pairing" \| "account"`                                                                                                                                                                        | `src/models/remote.ts`                                                     |

Remote method tiers:

- `account.sync` is `monitor`. It only delivers entries the host verifies against its pinned root,
  and it has to work for monitor-only phones, or their revocations wouldn't propagate. The handler
  calls `control()` only when the log actually advances.
- `account.request_link` is `monitor`. It just raises a console prompt.
- `account.status` is `monitor`. It returns `{ linked, account_id_hash, head_seq }` so the phone can
  offer "Add to account".

### 7.2 Host: `packages/host`

**New `src/services/account/`**

| File           | Responsibility                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.ts`    | HTTP client for §6.5 and request signing. Base URL `DEFAULT_ACCOUNT_URL = "https://houwert.dev/argus/account/v1"`, overridable like `relay_url`                                                                                             |
| `store.ts`     | The `account` field in `remote-devices.json`'s encrypted `RemoteState` (`deviceStore.ts`): `host_sign`, Electron's `dev_sign`/`dev_noise`, pinned root, and verified entries. It reuses `readState`/`writeState`, so it's encrypted at rest |
| `trust.ts`     | In-memory verified state: `findAccountDevice(noisePubB64)`, `materialize()` → `saveDevice({ source: "account" })`, `applyEntries()`. Revocations go through `revokeDevice` + `disconnectDevice`                                             |
| `link.ts`      | State machine for login/link (`idle → awaiting_claim(code) → awaiting_sas(sas, approver) → linked \| error`). Shared by Electron, the menu bar, and the CLI, like `serverPairing.ts`                                                        |
| `approvals.ts` | Polls `GET /join` while a console surface is open, and handles console approval (§4.4)                                                                                                                                                      |
| `presence.ts`  | Signs and publishes endpoints from `getEndpoints()`. Hooks `subscribeTunnelChange` and `setGatewayOnLan`; heartbeat 5 min                                                                                                                   |
| `sync.ts`      | Log polling (5 min + on connect) and the `account.sync` handler                                                                                                                                                                             |

**Edits**

- `services/remote/localGatewayServer.ts handleDeviceSocket`: after a `findDeviceByStaticKey` miss,
  try `trust.findAccountDevice` before the huddle check.
- `services/remote/deviceStore.ts`: `PairedDevice.source`. `rotateDesktopIdentity` calls
  `account.rotateHost()` when linked, and on a linked host keeps `source: "account"` devices.
- `services/remote/pairing.ts confirm()`: an optional `addToAccount` grant writes `add_device`
  signed by the host (recovery, §5.8).
- `services/remote/capabilities.ts`: handlers for the three remote methods.
- `commands/account.ts` (new) + `commands/account.typetest.ts`: `account_get_status` (admin),
  `account_list_hosts` (admin: the verified directory for the Electron renderer),
  `account_device_key` (host), and everything in the `HOST_ONLY_COMMANDS` list above.
- `bin/argus-host.ts`: console words `login`/`logout`/`approve`/`account`, and
  `argus-host login` as a subcommand (`bin/hostArgs.ts`).
- `boot.ts`: start `presence` and `sync` when linked. `shutdownHost` stops them.
- `telemetryEvents.ts`: §9.

### 7.3 Electron: `app/`, `electron/`

- `app/lib/ipc.ts`: wrappers for every new command. Re-export the models from `app/lib/types.ts`.
- **New** `app/components/shared/SettingsDialog/AccountSection.tsx` (< 300 lines; Peacock only):
  signed-out → "Sign in" (runs `account_login_start`, opens the browser, shows the code and a
  `Dialog` with the SAS when an approver appears); signed-in → account safety code, devices and hosts
  (rename/remove), pending requests with Approve (SAS dialog), and "Sign out".
- `HostsSection.tsx` and `app/lib/transport/registry.ts`: merge `account_list_hosts` with
  `settingsStore.remoteHosts`, deduped by host noise key (account wins on endpoints, the pairing keeps
  its grant). Account hosts connect with the key from `account_device_key`. `RemoteHost` gains
  `source`.
- `RemoteAccessSection.tsx`: the pairing confirm gains "Also add to my account" when linked.
- Routing: if the Settings dialog has per-section routes, add `settings/account` to
  `app/lib/router.tsx` and `docs/routing.md`.
- No Clerk SDK in Electron. The browser + code flow is the whole sign-in.

### 7.4 Apple: `clients/apple`

| Layer                                                                                        | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ArgusKit/Account/` (new)                                                                    | `AccountLog.swift` (verifier mirror), `AccountKeys.swift` (Ed25519 + X25519 in Keychain via `Keystore`), `AccountClient.swift` (HTTP §6.5, takes a token provider closure), `AccountSas.swift` (reuses `Crypto/Derive.swift`). Tests read the shared TS fixtures                                                                                                                                                                                                                                                                                                   |
| `ArgusKit/Storage/DeviceIdentity.swift`                                                      | `source: Source { paired, account }` (defaults to `.paired` when decoding old Keychain data), `accountHostId`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **New SPM package** `ArgusAuth`                                                              | The only place that imports **ClerkKit** (`clerk-ios`: iOS 17 / macOS 14+, so our iOS 18 / macOS 15 floor is fine). Exposes `AccountAuth` (`signInWithApple()`, `signInWithGitHub()`, `sendEmailCode`/`verify`, `token()`, `signOut()`). ArgusCore stays free of the Clerk dependency, and its tests use a fake                                                                                                                                                                                                                                                    |
| `ArgusCore/Account/` (new)                                                                   | `AccountStore` (@Observable): sign-in state, verified members, directory merged with presence, pending requests, `approve(_:)`, `deny`, `revoke`, `link(code:)`, `requestLink(host:)`                                                                                                                                                                                                                                                                                                                                                                              |
| `ArgusCore/Hosts/RemoteHostsStore.swift` (Mac) and `ArgusRemote/Stores/AppStore.swift` (iOS) | Host list = paired ∪ account, deduped by `desktopPubB64`. `connect(to:)` is unchanged because an account host is just a `DeviceIdentity` built from the log. After `onReady`, call `account.sync`                                                                                                                                                                                                                                                                                                                                                                  |
| `ArgusRemote`                                                                                | **New** `Screens/AccountView.swift` (sign-in: native SIWA button first, then GitHub, then email code), `Screens/ApproveJoinView.swift` (SAS + match/deny), `Screens/AddComputerView.swift` (enter code). Edits: `PairView.swift` (primary "Sign in", secondary "Scan QR"), `HomeView.swift`/`ComputerView.swift` (online/offline from presence), `SettingsView.swift`/`DevicesView.swift` (account devices, safety code, sign out). Each new file needs its four `project.pbxproj` entries. Add the _Sign in with Apple_ entitlement to `ArgusRemote.entitlements` |
| `ArgusDesktop` (synced group)                                                                | **New** `Settings/Account/AccountSettingsTab.swift`. `Settings/Hosts/HostsSettingsTab.swift` shows account hosts. On first sign-in, run `account_link_local` over `LocalTransport` (§5.2b). Add the SIWA entitlement and the regenerated Developer ID profile                                                                                                                                                                                                                                                                                                      |
| `ArgusRemote/Stores/AppStore+Push.swift` (phase 3)                                           | Built: `AccountStore+Push.swift` registers with the account (`PUT /push/registration`, the push key sealed per host from `dev_noise` + the host's `noise_pub`, wire contract § Phase 3) and re-seals when hosts join or leave; account hosts skip per-host `device.register_push` once that succeeded. Wake-ups land in the app delegate (`AccountWake`)                                                                                                                                                                                                           |
| `Envelopes.swift`                                                                            | `RemoteMethod` cases for `account.sync`, `account.request_link`, `account.status`. Run `pnpm gen:protocol` for the command catalog                                                                                                                                                                                                                                                                                                                                                                                                                                 |

App Store guideline 4.8: offering GitHub/email login on iOS requires an equivalent privacy-preserving
option. Native Sign in with Apple satisfies it, and is shown first.

### 7.5 Web client (`clients/argus-web`)

Unchanged in phases 1–4: it is served by a host on its LAN origin, which can't be a stable Clerk
origin, and it already has a pairing. Phase 5 looks at a hosted client on houwert.dev.

### 7.6 Command contract checklist (per new host command)

1. Handler in `packages/host/src/services/account/`
2. Catalog entry in `packages/remote-protocol/src/commands/account.ts`, models in `models/account.ts`,
   and an `Expect<Equal<…>>` in `packages/host/src/commands/account.typetest.ts`
3. `defineTypedCommand` in `packages/host/src/commands/account.ts`
4. Wrapper in `app/lib/ipc.ts`; re-export types in `app/lib/types.ts`
5. `pnpm gen:protocol`, then the Swift `RemoteMethod`/store/UI for the remote methods

## 8. Settings and docs

**Host settings** (machine-local, stored with the other remote config in the encrypted blob; editable in
Electron _Account_ and Mac _Account_ settings, and via `argus-host account set …`):

| Setting                                              | Default          | Notes                                                                |
| ---------------------------------------------------- | ---------------- | -------------------------------------------------------------------- |
| `account.enabled`                                    | on once linked   | Off = stop presence and polling, refuse account devices; stay linked |
| `account.service_url`                                | empty (built-in) | Self-hosting / staging, mirrors `push_config.relay_url`              |
| `account.grants.ios`                                 | `control`        | `monitor` / `control`                                                |
| `account.grants.desktop`                             | `control+admin`  | For `mac`/`electron` devices                                         |
| `account.publish.lan` / `.tailscale` / `.cloudflare` | on / on / on     | Which endpoint kinds go into presence. LAN IPs are metadata (§3)     |
| `account.hosts_can_approve`                          | on               | Lets this host's console approve joins (§4.4)                        |
| `account.tunnel` (phase 4)                           | on               | Run the managed tunnel while remote access is on                     |

**Docs**

- `docs/app-settings.md`: new "Account" section (sign in, linked computers, approval, settings above).
  Update "Remote access" so the account path comes first and QR pairing becomes the no-account path.
- `docs/server-app.md`: `argus-host login` / `approve` / `logout`.
- `docs/mac-app.md`: account tab, local host auto-link.
- `docs/telemetry-events.md`: §9.
- `docs/routing.md`: any new Electron routes.
- New user-facing `docs/accounts.md`: what the service can and can't see (a plain-language version of §3).
- Changesets: `argus` minor per user-visible phase.

## 9. Telemetry

Follows the CLAUDE.md privacy rules: no names, emails, ids, URLs, codes or keys, only enums, booleans
and counts. The host captures what it does. iOS captures only phone-local acts.

**Host (`packages/host/src/telemetryEvents.ts`)**

| Event                      | Props                                                                                                   | Fires when                                              | Answers                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------ |
| `account_link_started`     | `surface: "electron" \| "mac" \| "cli" \| "menubar"`                                                    | `account_login_start`                                   | Is linking used, and where?          |
| `account_linked`           | `via: "browser" \| "app" \| "local" \| "paired"`, `first_member: boolean`, `kind: "host" \| "computer"` | Host pins the root                                      | Does linking finish?                 |
| `account_link_failed`      | `stage: "start" \| "claim_timeout" \| "sas_rejected" \| "verify" \| "network"`                          | `link.ts` error                                         | Where does it break?                 |
| `account_join_resolved`    | `action: "approved" \| "denied"`, `approver: "host"`                                                    | Console approval                                        | Is console approval/recovery used?   |
| `account_member_revoked`   | `role: "device" \| "host"`, `source: "local" \| "log"`                                                  | Host applies a revoke                                   | Revocation volume and path           |
| `account_log_rejected`     | `reason: "fork" \| "bad_signature" \| "unknown_signer" \| "sas_mismatch"`                               | Verifier refuses                                        | Attacks or bugs                      |
| `remote_connection_opened` | `trust: "paired" \| "account"`                                                                          | Successful `/device` handshake, once per device per day | Do account hosts replace QR pairing? |
| `managed_tunnel_started`   | `created: boolean`, `install: "downloaded" \| "managed" \| "override" \| "path"`                        | Phase 4: the connector registered                       | Do managed tunnels come up?          |
| `managed_tunnel_failed`    | `stage: "unavailable" \| "credentials" \| "install" \| "connect"`                                       | Phase 4: once per stage per launch                      | Where do they break?                 |
| `legacy_tunnel_retired`    | `kind: "cloudflare_quick" \| "cloudflare_token" \| "tailscale_funnel"`, `reason: "managed" \| "user"`   | Phase 4 migration                                       | How many old setups are left?        |

**iOS (`clients/apple/ArgusRemote/Telemetry/TelemetryEvent.swift`)**

| Case → event                                  | Props                                                                     | Fires when                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `accountSignedIn` → `ios_account_signed_in`   | `provider: apple\|github\|email`, `firstDevice: Bool`                     | ClerkKit sign-in + account bootstrap                                                                                                            |
| `accountSignedOut` → `ios_account_signed_out` | —                                                                         | Sign out                                                                                                                                        |
| `joinActed` → `ios_join_acted`                | `action: requested\|approved\|denied\|expired`, `role: subject\|approver` | The phone's side of an approval                                                                                                                 |
| `memberRemoved` → `ios_member_removed`        | `role: device\|host`                                                      | The phone writes a revoke                                                                                                                       |
| `computerAdded` → `ios_computer_added`        | `via: code\|existing_pairing`                                             | The phone approves a host link (the host's `account_linked` counts completion; this counts the phone-side entry point, so they don't double up) |

**Mac app:** sign-in goes through ArgusAuth on the Mac, so it reports through whatever telemetry sink
ArgusDesktop uses (open question 8). Its local-host link is captured by the host as `account_linked { via: "local" }`.

`packages/host/src/telemetryDocs.test.ts` must pass with all of the above documented.

## 10. Migration

- Nothing breaks. Every existing pairing keeps working with `source: "pairing"`, and accounts are
  opt-in.
- On first sign-in, a phone with QR-paired hosts sees "Add your paired computers to your account".
  Per host, it calls `account.status` (are you linked to _this_ account?), then `account.request_link`
  → console confirm (§5.2c).
- **Identity merge.** Once a paired host is also an account host, the phone switches it to
  `dev_noise`. The first account connection calls `account.sync`, which carries
  `claim: { paired_device_id, sig_by_old_noise_proof }`. The host then moves the old record's grants
  and push registration onto the account device and deletes the old key. The proof is a Noise-channel
  binding: the claim travels inside the session authenticated by the old key, so no extra signature
  is needed. The phone then drops the per-pairing keypair.
- Electron `settingsStore.remoteHosts` and the Mac `PairedHostsFile` are merged the same way.
- Push: phase 3 keeps `device.register_push` for paired-only hosts. The relay accepts both auth modes
  for at least two releases.

## 11. Phases

### Phase 1: account, directory, sign-in (Mac + iOS + hosts)

Scope: §6 minus push, genesis, host linking (§5.2 a/b/c), presence/directory, account-trust
handshake, revocation, rotation, the console approval CLI words, and the Electron browser login.
Joining a **second device** isn't possible yet: it shows "Waiting for device approval (coming soon)",
and the existing QR pairing still works.

Acceptance:

- First iPhone sign-in (Apple, GitHub or email) creates genesis. Linking a headless mini via
  `argus-host login` + the code typed into the phone lists the mini, and the phone connects with no QR.
- Restarting a quick tunnel changes the URL. The phone reconnects within 60 s of the new presence,
  with no re-pair.
- The Mac app's first sign-in lists "This Mac" and its local host as an account host automatically.
- Service tamper tests (§11 test plan) all fail closed.
- `pnpm lint`, `swift test` (ArgusKit/ArgusCore), and both `xcodebuild` builds pass.

### Phase 2: device approval

Scope: `POST /join`, approval UI on iOS/Mac/Electron, console approval and recovery (§5.8), the
`account.sync` revocation push, identity merge (§10), and account reset.

Acceptance:

- A second iPhone signs in, shows a code, gets approved on the first, and lists and connects to every
  host. A Mac approves an iPhone and the reverse works too.
- With every device wiped, the user recovers via `argus-host approve` on the mini, and via QR pair →
  "Also add to account".
- Revoking a phone disconnects it from every host it's connected to within 5 s (sync), and from hosts
  it isn't connected to within 5 min (poll). This holds with the service blocked for the sync case.

Built (see `plan/accounts-wire-contract.md` § Phase 2 for the exact flow):

- Device joins on iPhone and Mac (`AccountStore+Join.swift`): `POST /join`, poll `GET /join/:id`,
  the SAS checked against the approver's key and head in the verified log, adoption only through
  `admits(…)` with the confirmed commit (kept in the vault, so a relaunch can't adopt an
  unconfirmed approval). The open request is persisted too, so a relaunch resumes it rather than
  filing another; one approved while the device was away is offered again with its code
  recomputed from the log (`AccountLog.approvals`, also listed beside each device on the
  approver) and adopted only after "Codes Match". A device whose key is already live never asks
  again, and withdraws its own stale request.
- Approving on iPhone, Mac and Electron (in-app prompt while open + Settings → Account), and from
  a host console (`argus-host approve`, the Electron prompt) — open question 3 kept at the plan's
  default, `hosts_can_approve` on.
- `account.sync` (monitor, denied to huddle guests) after every handshake and after every append;
  a host's handshake miss re-reads the log (≤ once per 15 s) so a fresh device connects at once.
- Device list, rename and remove on every client. Open question 6 stays at "a host only revokes
  itself": Electron removes and renames through its window's device key instead.

Deferred: identity merge (§10), account reset (§5.8 "Nothing at all"), the QR pairing "Also add to
your account" checkbox (§5.8 recovery — `argus-host approve` covers it). Silent push for join
requests landed in phase 3.

### Phase 3: push and presence via the account

Scope: `push_registrations`/`push_keys`, host-signed relay sends (`functions/argus/push` reads
`ARGUS_ACCOUNT` to check that host and device share an account and are live), sealed silent push for
join requests and revocations, and online/offline in every host list.

Acceptance:

- Linking a new host means the phone gets that host's notifications without ever opening it.
- The relay still never sees plaintext, because sealing is unchanged.
- The relay rejects a send from a revoked host.

Built (wire contract § Phase 3):

- Service: `0002_push.sql`; `PUT`/`DELETE /push/registration`, `GET /host/push-keys`, and
  host-signed `POST /push/send` live in the account service (`server/argus-account/push.ts`), not
  the relay: one base URL for everything a linked host says, `service_url` overrides included.
  A send needs a live host and a live device on the same account and epoch, and a key the device
  sealed for that host. APNs/FCM delivery moved to `server/argus-push/providers.ts`, shared with
  the unchanged per-device relay. Revokes, rotations and account deletion drop registrations.
- Sealing: the push key is wrapped with X25519(dev_noise, host noise_pub) + HKDF rather than an
  ephemeral sealed box, so a grant authenticates its device and the service can't plant a key.
  `auth_key` is gone from the account path.
- Host: `account/push.ts` reads and opens the grants (re-read when the log moves, ≤ 2 min stale),
  and `dispatch.ts` sends to account devices that aren't connected and whose push key no
  registration on this host already carries — so a phone reached both ways gets one push.
- "Sealed silent push" became a **content-free** wake-up: the service originates it (on joins and
  membership changes) and has no key to seal with, so it carries only `join | changed`; the phone
  re-reads and verifies everything itself, applies removals, re-seals for new hosts, and posts a
  local _Approve a new device?_ for each new verified request. It runs in the app delegate's
  background handler (not the Notification Service Extension, which only sees alerts). iOS
  doesn't deliver background pushes to an app the user force-quit; the next launch catches up.
- Presence: online/offline in the iPhone's Home/Computer/Account screens (phase 2), the Mac's
  Hosts and Account settings and its machines menu, and Electron's Account section and every host
  list (`useHostEntries`), all on the 60 s refresh and 15-minute window.
- Not done: the Mac app registers no push token (it has no APNs client), so its account device
  gets no account pushes; Android/FCM has no client.

### Phase 4: managed tunnels (the primary remote route)

Every linked host with remote access on gets a named Cloudflare Tunnel on the service owner's
account, `argus-<hash>.houwert.dev`, created and torn down by the account service. It replaces the
user-managed options (cloudflared quick/token tunnels, Tailscale Funnel). Exact flow, names, the
Cloudflare calls and the D1 table: wire contract § Phase 4.

Decisions:

- **One label under `houwert.dev`**, not `*.argus.houwert.dev`: Universal SSL covers only one level
  of wildcard; a deeper name needs Advanced Certificate Manager. The label is
  `argus-` + 16 hex of `sha256("argus-tunnel-v1\n" + host_id)`, so a re-created tunnel keeps its
  address and clients keep their stored endpoint.
- **Noise inside the tunnel.** The edge terminates TLS but sees only Noise ciphertext: stronger than
  a comparable product whose tunnel edge sees plaintext and whose relay is a trusted broker. Ingress
  points only at `http://127.0.0.1:<gateway port>`; the service sets it from the port the host
  reports, never from a caller-supplied URL.
- **The service issues credentials, the host keeps them.** `POST /host/tunnel` is host-signed and
  keyed only by the signing member, so no request can name another host. The connector token is
  never stored in D1 (fetched from Cloudflare per request); the host keeps it in its encrypted
  account record and passes it to `cloudflared` via `TUNNEL_TOKEN`, never argv.
- **Pinned `cloudflared`, downloaded on first need** into `$ARGUS_HOME/bin/cloudflared/<version>/`
  (SHA-256 per platform in `services/remote/cloudflared.ts`, version 2026.10.4), with
  `ARGUS_CLOUDFLARED_PATH` as the user's override and `PATH` as the fallback when the download
  fails. Not bundled: it would add ~40 MB to each of the Electron app, the Mac app and the server
  app, and a third-party binary inside the Mac bundle has to be re-signed for notarization. Node's
  `fetch` sets no quarantine flag, and neither app is sandboxed, so the download runs as is.
- **Reclamation without cron.** Pages has no cron, so the account service sweeps lazily on ~1 % of
  requests (≤ 3 releases): tunnels of hosts that are no longer live members, and tunnels idle for
  14 days (`max(last_used, presence last_seen)`). Revokes and account deletion release at once
  (`waitUntil`). A follow-up could move the sweep to a Worker cron if the lazy one lags.
- **Route order unchanged**: LAN → Tailscale → managed tunnel. "Tailscale" is now the host's tailnet
  IP (`ws://100.x.y.z:port`, 100.64.0.0/10) rather than a Funnel URL — a bare IP needs no ATS
  exception and nothing to configure. Clients race all routes at connect (existing `EndpointRacer`)
  and, while on a worse route, re-check better ones on network change and every few minutes, with
  a cooldown after a failed check (the connection-supervisor idea).
- **Migration.** The old settings (`remote_tailscale_enabled`, `remote_cloudflare_enabled`,
  `remote_tunnel_mode`, `remote_tunnel_token`, `remote_public_url`, `remote_provider`) can't be set
  any more. A tunnel they describe keeps running (`legacyTunnels` in `remote_get_status`) until the
  managed tunnel registers; then it is stopped and the settings cleared
  (`legacy_tunnel_retired`). Settings → Remote access also offers "Stop using it". QR-only hosts keep
  LAN + tailnet, and an old tunnel keeps running there indefinitely: removing it would strand a
  phone that only reached the computer through it. Huddles still raise a temporary quick tunnel
  (now with the pinned binary) when nothing else reaches the host, since a guest's browser can't use
  a LAN or tailnet address.
- **Degrades cleanly.** No API token or ids → `managed_tunnels: false`, `503 unavailable`; the host
  shows "unavailable", retries hourly, and keeps LAN/Tailscale.

Built:

- Service (houwert.dev): `0003_tunnels.sql`, `server/argus-account/{cloudflare,tunnels}.ts`,
  `POST`/`DELETE /host/tunnel`, release on revoke and `DELETE /account`, the lazy sweep, 12 / hour per
  host and 20 tunnels per account, tests against a fake Cloudflare API and a smoke run against a
  local mock.
- Host: `services/remote/{cloudflared,managedTunnel,legacyTunnels}.ts`,
  `services/account/tunnel.ts` (credentials, install, supervision, refresh on rejection, release on
  unlink), tailnet endpoint in `endpoints.ts`, `account set tunnel on|off`, `RemoteStatus`
  reshaped (`tailscaleUrl`, `managedTunnel`, `legacyTunnels`), Tailscale-Funnel setup removed.
- Clients: Electron, Mac and iOS settings show the routes, the tunnel's state and any legacy tunnel;
  the Account settings gain the tunnel switch; route re-checks on network change (iOS, Mac,
  Electron).

Deploy order: secret + vars (§ "What Douwe needs to do" 7a) → `wrangler d1 migrations apply
argus-account --remote` → push houwert.dev `main` → ship the Argus release. Older Argus hosts never
call the new routes; new hosts against an old service get a 404 and back off like `unavailable`.

### Phase 5 (later): hosted web client

`houwert.dev/argus/app` with Clerk JS, a WebCrypto device key in IndexedDB (non-extractable), and
the same join flow. Gated on whether WebSocket-to-LAN from a public origin is workable (mixed content
from https to `ws://` LAN is blocked, so only tunnel endpoints are possible).

### Test plan (all phases)

| Layer                 | Tests                                                                                                                                                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verifier (TS + Swift) | Golden fixtures: valid chain; bad sig; wrong `prev`; unknown signer; host signs `add_device` without permission; `rotate` missing the old sig; `sas_commit` mismatch; epoch reset not followed; replayed old presence                                                        |
| Service               | Local `wrangler pages dev` + local D1 (no remote resources) driven by vitest scripts: CAS conflict on concurrent appends, rate limits, expired codes, Clerk JWT verify against a locally minted JWKS, host signature window                                                  |
| Tamper suite          | A fake service that (a) swaps a host's `noise_pub` in `/directory`, (b) injects an unsigned `add_device`, (c) serves a fork, (d) withholds a revoke, (e) points presence at a foreign URL. Expected: a, b, c, e are rejected by clients/hosts; d is caught by `account.sync` |
| Host                  | `localGatewayServer` accepts an account device, rejects a revoked one, materializes and merges grants; `link.ts` state machine; `noElectron.test.ts` stays green                                                                                                             |
| E2E                   | Two hosts in `/tmp` `ARGUS_HOME`s launched by path (never the live Argus), against local Pages; iOS simulator build via `xcodebuild … ArgusRemote`; manual device test on a real phone for SIWA                                                                              |

## 12. Open questions

1. **Mac app SIWA under Developer ID.** Resolved: Apple doesn't support Sign in with Apple for
   Developer ID apps (the issued profile omits the entitlement even when the portal lists it), so
   Release signs in with Apple through Clerk's web OAuth; Debug keeps the native sheet. Clerk
   production then needs an Apple Services ID + key for web sign-in (see question 2).
2. **Clerk production Apple toggle.** Does it insist on a Services ID + key even when only native
   apps sign in with Apple? If so, step 4 of the checklist grows by one Apple key.
3. **Approver set.** Should host consoles be able to approve devices by default (§4.4)? It makes
   recovery painless, but a compromised host can then mint devices for your other hosts.
4. **Encrypt names?** Wrap device and host names with an account key that devices share via approvals,
   so the service sees no names. It costs a key-distribution step in every join.
5. **Grant defaults.** Should a newly approved Mac get `admin` on every host automatically, or should
   each host confirm it once?
6. **Host-written revokes of others.** Allow a host console to revoke _any_ member (useful when your
   only remaining thing is a host), or only itself?
7. **Clerk instance strategy.** Run phase-1 development against a Clerk _development_ instance
   (shared OAuth credentials, no DNS) and switch keys at launch? The design is identical either way,
   since `/config` serves the key.
8. **Mac telemetry sink.** Does ArgusDesktop have its own catalog, or should `account_signed_in`
   be captured host-side via a command?
9. **Account deletion.** Should `DELETE /account` also tell linked hosts to unlink (a signed self-revoke
   per host needs host keys), or just drop the directory and let hosts notice a 404?

## Prior art

A comparable product's hosted relay uses the same identity provider, but makes the relay a trusted
broker: it mints session credentials for environments and runs managed tunnels whose edge sees
plaintext. We keep the service untrusted (signed log, SAS approvals, Noise to pinned keys), run
managed tunnels the same way (named tunnel per host, pinned and checksum-verified `cloudflared`,
reclamation of idle tunnels) but carry only Noise ciphertext through them, and run our own
device-code step instead of Clerk's beta OAuth device grant.
