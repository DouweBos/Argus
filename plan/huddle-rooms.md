# Huddle rooms — sharing one agent and one device over a temporary link

An engineer in a huddle pastes a link. A designer opens it in a browser, the
engineer approves them, and the two of them talk to the same agent and drive the
same simulator until the huddle ends.

The constraint that shapes everything: **no infrastructure we operate.** No
signalling server, no relay, no accounts. Whatever this becomes, it has to work
from a laptop with nothing but the Argus app on it.

## 1. What already works

Most of the hard machinery landed with the remote-host work. Worth being precise
about it, because it changes what this feature actually costs.

**A public URL with zero config.** `cloudflared tunnel --url http://localhost:<port>`
returns an ephemeral `*.trycloudflare.com` HTTPS address with no account, no
domain and no DNS. It is already implemented as the `quick` Cloudflare mode in
`tunnelManager.ts` (`planFor()`). HTTPS means WSS and WebCrypto in the browser,
and `packages/remote-client` does its Noise handshake with `@noble/*`, which runs
unmodified in a browser.

**The host already serves the web client.** `localGatewayServer` serves the
`clients/argus-web` bundle from the same port the gateway listens on, so the
tunnel URL is the app, not just a socket.

**Two people on one agent already works.** This is the part that looks hardest
and is done:

- Permission prompts settle on every attached client — answering on one clears it
  everywhere, and `respondToPermission` is idempotent, so a double answer can't
  write twice to the runner's stdin.
- The message queue converges: every id-keyed mutation rebroadcasts the whole
  list to all clients, last-write-wins.
- Agent transcripts already fan out to every subscriber.

**Two people on one simulator already works.** `deviceClaims.ts` holds a soft
claim per device: acquired implicitly on first input, released after 30s idle, on
disconnect, or taken explicitly with `force`. `DeviceControlOverlay` shows
"Controlled by {label} — Take control" and disables input while someone else
holds it. The same claim covers the embedded browser under a `browser:<sessionId>`
key.

So the transport, the fan-out and the arbitration are all in place. What is
missing is entirely the **access model**.

## 2. What is missing

**2.1 Grants have no scope.** `PairedDevice.capabilities` is a flat
`Capability[]`. `control` means every agent, every session, every project and
every device on the host. A designer let in for one agent would get the
engineer's whole machine. This is the central gap.

**2.2 Pairings are permanent.** `PairedDevice` has `created_at` and `last_seen`
and no expiry. A huddle guest needs a grant that dies when the huddle does.

**2.3 The join flow is the wrong shape.** Pairing compares a 6-digit SAS on two
screens — right for adopting your own device, wrong for a link you paste into a
chat. A guest flow wants "Ana wants to join — Allow / Deny" on the host.

**2.4 The web client is a full client.** It has no single-agent mode.

**2.5 The bundle is gated on LAN web.** `remoteService.ts` passes
`staticDir: lanWeb ? webClientDir : null`, so a tunnel-only share serves no app.

## 3. Design

### 3.1 A room is a host-side object

```ts
interface HuddleRoom {
  id: string;
  /** High-entropy token carried in the link. Grants nothing on its own. */
  token: string;
  /** The one agent guests may talk to. */
  agent_id: string;
  /** The one device guests may drive, or null for chat-only. */
  device_key: string | null;
  created_at: number;
  expires_at: number;
  guests: HuddleGuest[];
}

interface HuddleGuest {
  /** Ephemeral X25519 public key the browser generated for this visit. */
  dev_static_pub: string;
  label: string;
  state: "pending" | "approved" | "denied";
  approved_at: number | null;
}
```

Rooms live in the same `safeStorage`-encrypted store as paired devices, or in
memory only — see §7.

### 3.2 The link is not a credential

The link carries the room token. Opening it gets you a **pending** connection and
nothing else: no agent, no transcript, no device. The host sees an approval
prompt; approving is what issues the grant, bound to the ephemeral public key
that browser generated on load.

This is the property that makes the link safe to paste into a huddle chat, and it
is worth protecting in review: **the token must never be sufficient by itself.**

### 3.3 Joining, end to end

1. Engineer picks an agent, hits **Share**, chooses whether the device comes too.
2. Host starts a quick tunnel if one isn't up, creates the room, shows the link.
3. Designer opens the link. The web client generates an ephemeral keypair,
   handshakes, and presents the room token. The host records a pending guest.
4. Engineer sees "Ana wants to join — Allow / Deny", approves.
5. The guest's connection is upgraded to a scoped grant and the web client drops
   into single-agent mode.
6. Engineer ends the huddle (or `expires_at` passes): every guest grant is
   revoked, live guest connections are dropped, the tunnel comes down if we
   raised it.

### 3.4 Scoped grants

`GatewayContext` gains an optional scope:

```ts
interface GrantScope {
  agent_ids: string[];
  device_keys: string[];
}
```

`dispatch()` currently checks `hasCapability(ctx, required)`. It gains a second
check: if the context carries a scope, every agent-addressed and device-addressed
method must name something inside it. There are ~22 `agent_id`-bearing methods in
`messages.ts` plus the `devices.*` family, so this is a table of
`method → param name`, mirroring the existing `ADMIN_INPUT_SUBJECT` map.

Methods that enumerate — `projects.list`, `sessions.list`, `agents.list` — must
be **filtered, not refused**, so a guest sees exactly one agent rather than an
error. `state.hydrate` needs the same treatment.

A scoped grant can never be `admin`. Admin is the raw passthrough; scoping it is
not meaningful and it must not be offered for a guest.

## 4. Where the code changes

| Area       | File                                                | Change                                                                                          |
| ---------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Room store | `packages/host/src/services/remote/huddle.ts` (new) | Rooms, guests, expiry sweep                                                                     |
| Handshake  | `localGatewayServer.ts`                             | `findDeviceByStaticKey` falls back to a room-token lookup, producing a pending guest connection |
| Dispatch   | `capabilities.ts`                                   | Scope check + list filtering                                                                    |
| Context    | `capabilities.ts`                                   | `GatewayContext.scope`                                                                          |
| Serving    | `remoteService.ts`                                  | Serve the bundle whenever any endpoint is up, not only on LAN web                               |
| Host UI    | `app/components/…`                                  | Share action, link display, approval prompt, guest list, end-huddle                             |
| Web client | `clients/argus-web`                                 | Pending state, single-agent mode, device pane                                                   |
| Protocol   | `packages/remote-protocol`                          | `huddle.join`, `huddle.state`, guest events                                                     |

## 5. Workstreams

**A. Scoped grants.** The scope type, the dispatch check, the method→param table,
list filtering, and the rule that scope excludes admin. Independent of everything
else and the highest-risk piece — do it first and test it hard.

**B. Rooms and expiry.** The store, the token, the sweep, revoke-on-end.

**C. Join and approval.** Pending connections at handshake, the host prompt, grant
issuance bound to the ephemeral key. _Depends on A and B._

**D. Guest web client.** Single-agent mode, the device pane, the pending screen.
_Depends on C for anything end to end._

**E. Host UI.** Share, link, guest list, end huddle.

**F. Serving and tunnel lifecycle.** Decouple the bundle from LAN web; raise and
drop a quick tunnel around a huddle.

## 6. Security notes

- **The token grants nothing.** Approval issues the grant. Anything that weakens
  this — auto-approve, "remember this guest", a token that pre-authorises —
  turns a chat-pasteable link into a bearer credential.
- **Guest keys are ephemeral and per-visit.** They are not added to the paired
  device list and must not appear in Settings → Remote access as if they were
  adopted hardware.
- **A quick tunnel URL is public.** That is fine — it always was. Every endpoint
  terminates at the same Noise handshake, and an unapproved guest cannot get past
  it. The tunnel does not widen the trust model.
- **Scope must be enforced host-side**, in `dispatch()`, never by the client
  hiding UI.
- **Guests can answer permission prompts if granted `control`.** That is a
  code-execution act on the engineer's machine. Consider whether guests should be
  `monitor` plus an explicit device grant instead — see §7.

## 7. Open questions

1. **Can a guest approve a tool-use prompt?** `control` includes
   `permission.respond`. Letting a designer approve a file write on someone
   else's laptop is a real decision, not an implementation detail. A third tier —
   chat and device input, but never permissions — may be warranted.
2. **Do rooms survive a restart?** In-memory is simpler and fails safe. Persisted
   survives an app crash mid-huddle. Leaning in-memory.
3. **Is the device optional?** Chat-only sharing is easier and may cover most
   huddles.
4. **More than one guest?** The design allows it; the device claim already
   arbitrates. Worth confirming the UI reads sensibly with three people.
5. **Quick-tunnel reliability.** Cloudflare rate-limits and rotates quick
   tunnels. Fine for a 30-minute huddle; needs a clear error when it isn't.
6. **Does the engineer keep working while sharing?** If the shared agent is the
   one they are using, the guest sees everything they type. Probably intended,
   but it should be said out loud in the share dialog.
