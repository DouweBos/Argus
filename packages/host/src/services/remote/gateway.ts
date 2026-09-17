/**
 * The remote gateway: turns a decrypted, authenticated device channel into
 * capability-gated calls against the existing service layer, and forwards a
 * filtered, encrypted event stream back.
 *
 * Transport-agnostic on purpose — a `DeviceConnection` takes a `NoiseSession`
 * and a raw `send(bytes)` sink, so the same class is driven by the real relay
 * socket in production and by an in-memory pipe in tests.
 */

import type { PairedDevice } from "./deviceStore";
import type { NoiseSession } from "./noise";
import type { PermissionRequestPayload } from "../llm/runners/claudeCode/controlHandler";
import type { H264Config } from "../simulator/h264-parser";
import {
  Envelope,
  EventPayloads,
  type RemoteEndpoint,
  type RemoteEventType,
  type RemotePlatform,
} from "@argus/remote-protocol";
import { addHostEventSink } from "@argus/host/bus";
import { log } from "@argus/host/logger";
import { appState } from "../../state";
import { onBrowserFrame } from "../browser/frameForward";
import {
  forceStopAndroidCapture,
  isAndroidCapturing,
  startAndroidCapture,
  stopAndroidCapture,
} from "../simulator/android";
import {
  forceStopSimulatorCapture,
  isSimulatorCapturing,
  startSimulatorCapture,
  stopSimulatorCapture,
} from "../simulator/ios";
import { onVideo } from "../simulator/videoForward";
import { TransferHub } from "../transfer/hub";
import { TAG_XFER } from "../transfer/protocol";
import {
  dispatch,
  GatewayError,
  permissionKey,
  toRemoteAgentCapabilities,
  toRemoteAgentStatus,
  type DeviceMediaController,
  type GatewayContext,
} from "./capabilities";
import { releaseConnection } from "./deviceClaims";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Plaintext tag distinguishing JSON envelopes from binary media frames. */
const TAG_JSON = 0x00;
const TAG_MEDIA = 0x01;

/** Media message types (first header byte after the tag). */
const MEDIA_CONFIG = 0;
const MEDIA_FRAME = 1;
const MEDIA_JPEG = 2;

/** Drop delta frames once the socket's send buffer exceeds this (bytes). */
const BACKPRESSURE_LIMIT = 1_000_000;

let nextStreamId = 1;
function allocStreamId(): number {
  const id = nextStreamId;
  nextStreamId = (nextStreamId + 1) & 0xffff || 1;

  return id;
}

/** Build the binary body (after the media tag) for a config message. */
function buildConfigBody(streamId: number, config: H264Config): Uint8Array {
  const codec = encoder.encode(config.codec);
  const body = new Uint8Array(
    12 + 5 + codec.length + config.description.length,
  );
  const view = new DataView(body.buffer);
  view.setUint8(0, MEDIA_CONFIG);
  view.setUint8(1, 0);
  view.setUint16(2, streamId, true);
  view.setFloat64(4, 0, true);
  view.setUint16(12, config.codedWidth, true);
  view.setUint16(14, config.codedHeight, true);
  view.setUint8(16, codec.length);
  body.set(codec, 17);
  body.set(config.description, 17 + codec.length);

  return body;
}

/** Build the binary body (after the media tag) for a frame message. */
function buildFrameBody(
  streamId: number,
  data: Uint8Array,
  keyFrame: boolean,
  timestamp: number,
): Uint8Array {
  const body = new Uint8Array(12 + data.length);
  const view = new DataView(body.buffer);
  view.setUint8(0, MEDIA_FRAME);
  view.setUint8(1, keyFrame ? 1 : 0);
  view.setUint16(2, streamId, true);
  view.setFloat64(4, timestamp, true);
  body.set(data, 12);

  return body;
}

/** Build the binary body for a standalone JPEG frame (embedded browser). */
function buildJpegBody(
  streamId: number,
  data: Uint8Array,
  timestamp: number,
): Uint8Array {
  const body = new Uint8Array(12 + data.length);
  const view = new DataView(body.buffer);
  view.setUint8(0, MEDIA_JPEG);
  view.setUint8(1, 0);
  view.setUint16(2, streamId, true);
  view.setFloat64(4, timestamp, true);
  body.set(data, 12);

  return body;
}

/**
 * Device video already rides the binary TAG_MEDIA channel, so mirroring these
 * IPC frames onto the raw path would send every frame twice.
 */
const VIDEO_CHANNEL_RE = /^(?:ios|android)_video_/;

/**
 * The subscription id a raw channel is scoped to, or null when it fans out to
 * every raw connection. Agent and terminal streams are per-id so a desktop
 * watching four agents doesn't receive a fifth's tokens (or another PTY's).
 */
function rawSubscriptionScope(channel: string): string | null {
  const agent = parseAgentChannel(channel);
  if (agent) {
    return agent.agentId;
  }
  const terminal = /^terminal:(?:data|exit):(.+)$/.exec(channel);

  return terminal ? `terminal:${terminal[1]}` : null;
}

/** Parsed agent channel, e.g. `agent:permission:<id>` → kind + agentId. */
function parseAgentChannel(
  channel: string,
): { kind: string; agentId: string } | null {
  const parts = channel.split(":");
  if (parts.length < 3 || parts[0] !== "agent") {
    return null;
  }

  return { kind: parts[1], agentId: parts.slice(2).join(":") };
}

/** One authenticated device: a Noise transport plus its subscriptions. */
export class DeviceConnection implements DeviceMediaController {
  /** Identifies this connection for claims; a reconnect is a new holder. */
  private readonly connectionId = crypto.randomUUID();
  private sendSeq = 0;
  private recvSeq = -1;
  private readonly subscriptions = new Set<string>();
  private readonly ctx: GatewayContext;
  /** Forward raw renderer broadcasts instead of typed events (admin devices). */
  private readonly raw: boolean;
  private closer: (() => void) | null = null;
  private bufferedProbe: (() => number) | null = null;
  /** Active screen streams for this connection, keyed by device id. */
  private readonly watched = new Map<
    string,
    { streamId: number; platform: RemotePlatform; unsub: () => void }
  >();
  /** Active embedded-browser streams for this connection, by session id. */
  private readonly watchedBrowsers = new Map<
    string,
    { streamId: number; unsub: () => void }
  >();
  /** Chunked file transfers in either direction, admin devices only. */
  private readonly transfers = new TransferHub({
    send: (body) => this.emitXfer(body),
    buffered: () => this.bufferedProbe?.() ?? 0,
  });

  constructor(
    readonly device: PairedDevice,
    private readonly session: NoiseSession,
    private readonly sink: (bytes: Uint8Array) => void,
  ) {
    this.ctx = {
      device,
      connectionId: this.connectionId,
      outstandingPermissions: new Set(),
      media: this,
    };
    // An admin device is another desktop: it runs the real UI off the host's
    // own IPC channels, so it gets raw broadcasts rather than the typed mirrors
    // the phone and web clients render — sending both would double the stream.
    this.raw = device.capabilities.includes("admin");
  }

  /** Register how to tear down the underlying socket (set by the server). */
  setCloser(fn: () => void): void {
    this.closer = fn;
  }

  /** Probe the socket's outbound buffer, for backpressure-based frame dropping. */
  setBufferedProbe(fn: () => number): void {
    this.bufferedProbe = fn;
  }

  close(): void {
    this.closer?.();
  }

  /**
   * Release everything this connection held — screen streams and any device
   * claim. Called when the connection goes away, so a dropped client never
   * leaves a simulator locked to a socket that no longer exists.
   */
  dispose(): void {
    for (const deviceId of [...this.watched.keys()]) {
      this.unwatch(deviceId);
    }
    for (const sessionId of [...this.watchedBrowsers.keys()]) {
      this.unwatchBrowser(sessionId);
    }
    // A transfer cut off mid-flight must leave no partial behind.
    this.transfers.dispose();
    releaseConnection(this.connectionId);
  }

  // --- DeviceMediaController -------------------------------------------------

  async watch(deviceId: string, platform: RemotePlatform): Promise<number> {
    const existing = this.watched.get(deviceId);
    if (existing) {
      return existing.streamId;
    }

    if (platform === "ios") {
      await startSimulatorCapture(deviceId);
    } else {
      // Android capture is per-serial and ref-counted (like iOS). Acquiring a
      // ref starts the backend on first holder; multiple emulators — and
      // multiple viewers of one emulator — stream concurrently.
      await startAndroidCapture(deviceId);
    }

    const streamId = allocStreamId();
    log(`[remote] watch ${platform} ${deviceId} → stream ${String(streamId)}`);
    let loggedFirst = false;
    const unsub = onVideo(deviceId, {
      onConfig: (config) => this.emitMedia(buildConfigBody(streamId, config)),
      onFrame: (data, keyFrame, timestamp) => {
        // Never drop config/keyframes; shed delta frames under backpressure.
        if (
          !keyFrame &&
          this.bufferedProbe &&
          this.bufferedProbe() > BACKPRESSURE_LIMIT
        ) {
          return;
        }
        if (!loggedFirst) {
          loggedFirst = true;
          log(
            `[remote] forwarding frames for ${deviceId} (stream ${String(streamId)})`,
          );
        }
        this.emitMedia(buildFrameBody(streamId, data, keyFrame, timestamp));
      },
    });
    this.watched.set(deviceId, { streamId, platform, unsub });

    return streamId;
  }

  unwatch(deviceId: string): void {
    const entry = this.watched.get(deviceId);
    if (!entry) {
      return;
    }
    entry.unsub();
    this.watched.delete(deviceId);

    if (entry.platform === "ios") {
      stopSimulatorCapture(deviceId);
      // If no one else (the desktop view or another remote device) still holds
      // the capture, tear it down immediately rather than leaving the bridge
      // running through its grace period — a remote viewer that left the screen
      // shouldn't keep the simulator captured.
      if (!isSimulatorCapturing(deviceId)) {
        forceStopSimulatorCapture(deviceId);
      }
    } else {
      stopAndroidCapture(deviceId);
      // If no one else (the desktop grid/panel or another remote viewer) still
      // holds the capture, tear it down now rather than through the grace
      // period — a remote viewer that left shouldn't keep the emulator captured.
      if (!isAndroidCapturing(deviceId)) {
        forceStopAndroidCapture(deviceId);
      }
    }
  }

  watchBrowser(sessionId: string): number {
    const existing = this.watchedBrowsers.get(sessionId);
    if (existing) {
      return existing.streamId;
    }

    const streamId = allocStreamId();
    log(`[remote] watch browser ${sessionId} → stream ${String(streamId)}`);
    const unsub = onBrowserFrame(sessionId, (data, timestamp) => {
      // Every JPEG stands alone, so shedding under backpressure only costs
      // staleness — no reference chain to break, unlike H.264 deltas.
      if (this.bufferedProbe && this.bufferedProbe() > BACKPRESSURE_LIMIT) {
        return;
      }
      this.emitMedia(buildJpegBody(streamId, data, timestamp));
    });
    this.watchedBrowsers.set(sessionId, { streamId, unsub });

    return streamId;
  }

  unwatchBrowser(sessionId: string): void {
    const entry = this.watchedBrowsers.get(sessionId);
    if (!entry) {
      return;
    }
    entry.unsub();
    this.watchedBrowsers.delete(sessionId);
  }

  /** Handle one encrypted inbound frame from the transport. */
  async onFrame(cipher: Uint8Array): Promise<void> {
    let envelope: Envelope;
    try {
      const plain = this.session.decrypt(cipher);
      // Transfer chunks are handled synchronously, before any await, so the
      // socket's frame order is the order the receiver sees — the `end` message
      // always lands before the `transfer.complete` request that follows it.
      if (plain.length > 0 && plain[0] === TAG_XFER) {
        if (this.raw) {
          this.transfers.onBody(plain.subarray(1));
        }

        return;
      }
      // Inbound media (tag 0x01) is client→gateway only in theory; the client
      // never sends it, so drop anything that isn't a JSON envelope.
      if (plain.length === 0 || plain[0] !== TAG_JSON) {
        return;
      }
      envelope = Envelope.parse(JSON.parse(decoder.decode(plain.subarray(1))));
    } catch {
      // Undecryptable or malformed frames are dropped silently — a
      // well-behaved peer never produces them, an attacker learns nothing.
      return;
    }

    // Reject stale/replayed app-layer frames (Noise already blocks replays
    // within a session; this guards reordering across the envelope layer).
    if (envelope.seq <= this.recvSeq) {
      return;
    }
    this.recvSeq = envelope.seq;

    if (envelope.type === "sub") {
      if (envelope.action === "subscribe") {
        this.subscriptions.add(envelope.agent_id);
        this.replayPendingPermissions(envelope.agent_id);
      } else {
        this.subscriptions.delete(envelope.agent_id);
      }

      return;
    }

    if (envelope.type === "req") {
      await this.handleRequest(envelope.id, envelope.method, envelope.params);
    }
    // "res"/"evt" are gateway→device only; ignore if a client sends them.
  }

  private async handleRequest(
    id: string,
    method: string,
    params: unknown,
  ): Promise<void> {
    try {
      const ok = method.startsWith("transfer.")
        ? await this.handleTransfer(method, params)
        : await dispatch(method, params, this.ctx);
      this.emit({ type: "res", seq: this.nextSeq(), id, ok });
    } catch (err) {
      const code =
        err instanceof GatewayError ? err.code : ("internal" as const);
      const message = err instanceof Error ? err.message : "error";
      const data = err instanceof GatewayError ? err.data : undefined;
      this.emit({
        type: "res",
        seq: this.nextSeq(),
        id,
        error: { code, message, data },
      });
    }
  }

  /** Tell this device every address it could reach the desktop on. */
  pushEndpoints(endpoints: RemoteEndpoint[]): void {
    this.pushEvent("host.endpoints", null, { endpoints });
  }

  /**
   * The `transfer.*` control plane.
   *
   * Transport machinery rather than a command: it manipulates this socket's own
   * state, so it never reaches the command registry. Gated on `admin`, the same
   * tier `upload_session_attachment`, `read_file` and `write_file` carry — a
   * monitor/control client has no business writing to the host's disk.
   */
  private async handleTransfer(
    method: string,
    params: unknown,
  ): Promise<unknown> {
    if (!this.raw) {
      throw new GatewayError(
        "capability_denied",
        "device lacks 'admin' capability",
      );
    }
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case "transfer.upload.open":
        return await this.transfers.openUpload({
          purpose: p.purpose === "file" ? "file" : "attachment",
          session_id: String(p.session_id ?? ""),
          name: String(p.name ?? ""),
          size: Number(p.size ?? -1),
        });
      case "transfer.upload.complete":
        return await this.transfers.completeUpload(Number(p.transfer_id));
      case "transfer.download.open":
        return await this.transfers.openDownload({
          session_id: String(p.session_id ?? ""),
          path: String(p.path ?? ""),
        });
      case "transfer.abort":
        this.transfers.abort(Number(p.transfer_id));

        return null;
      default:
        throw new GatewayError("capability_denied", `unknown method ${method}`);
    }
  }

  /**
   * Mirror a renderer broadcast verbatim. Subscription-scoped channels (agents,
   * terminals) are dropped unless this connection asked for that id; everything
   * else — session/project/git/device changes, notifications — fans out.
   */
  private forwardRawBroadcast(channel: string, args: unknown[]): void {
    if (VIDEO_CHANNEL_RE.test(channel)) {
      return;
    }
    const scope = rawSubscriptionScope(channel);
    if (scope !== null && !this.subscriptions.has(scope)) {
      return;
    }
    this.pushEvent("ipc", null, { channel, args });
  }

  /**
   * Keep `outstandingPermissions` accurate on raw connections too — the typed
   * `permission.respond` method validates against it, and an admin device may
   * answer a prompt through either dialect.
   */
  private trackPermissions(channel: string, args: unknown[]): void {
    const parsed = parseAgentChannel(channel);
    const toolUseId = (args[0] as { tool_use_id?: string } | undefined)
      ?.tool_use_id;
    if (!parsed || !toolUseId) {
      return;
    }
    const key = permissionKey(parsed.agentId, toolUseId);
    if (parsed.kind === "permission") {
      this.ctx.outstandingPermissions.add(key);
    } else if (
      parsed.kind === "permission-cancel" ||
      parsed.kind === "permission-resolved"
    ) {
      this.ctx.outstandingPermissions.delete(key);
    }
  }

  /** Forward a tapped renderer broadcast to this device, if relevant. */
  handleBroadcast(channel: string, args: unknown[]): void {
    if (this.raw) {
      this.trackPermissions(channel, args);
      this.forwardRawBroadcast(channel, args);

      return;
    }

    // User-facing notifications go to every connected device, regardless of
    // which agent it happens to be subscribed to — that's the whole point.
    if (channel === "remote:notification") {
      const p = args[0] as { agent_id?: string | null } | undefined;
      this.pushEvent("notification", p?.agent_id ?? null, p);

      return;
    }

    // Losing the device claim is otherwise invisible to a typed client until
    // its next HID event comes back capability_denied.
    if (channel === "devices:claim-changed") {
      this.pushEvent("device.claim", null, args[0]);

      return;
    }

    const parsed = parseAgentChannel(channel);
    if (!parsed) {
      return;
    }
    const { kind, agentId } = parsed;
    if (!this.subscriptions.has(agentId)) {
      return;
    }

    switch (kind) {
      case "event":
        this.pushEvent("agent.event", agentId, {
          agent_id: agentId,
          event: args[0],
        });
        break;
      case "status": {
        const agent = appState.agents.get(agentId);
        if (agent) {
          this.pushEvent("agent.status", agentId, toRemoteAgentStatus(agent));
        }
        break;
      }
      case "queue":
        this.pushEvent("agent.queue", agentId, {
          agent_id: agentId,
          messages: args[0],
        });
        break;
      case "capabilities": {
        const init = appState.agents.get(agentId)?.handle.initializeResponse();
        if (init) {
          this.pushEvent(
            "agent.capabilities",
            agentId,
            toRemoteAgentCapabilities(init),
          );
        }
        break;
      }
      case "permission": {
        const p = args[0] as PermissionRequestPayload;
        this.ctx.outstandingPermissions.add(
          permissionKey(agentId, p.tool_use_id),
        );
        this.pushEvent("permission.request", agentId, {
          agent_id: agentId,
          tool_use_id: p.tool_use_id,
          tool_name: p.tool_name,
          tool_input: p.tool_input,
        });
        this.pushAgentStatus(agentId);
        break;
      }
      // Answered — by this device, another client, or the host's own window.
      // Every attached client must drop the prompt, not just the responder.
      case "permission-resolved":
      case "permission-cancel": {
        const p = args[0] as { tool_use_id: string };
        this.ctx.outstandingPermissions.delete(
          permissionKey(agentId, p.tool_use_id),
        );
        this.pushEvent("permission.cancel", agentId, {
          agent_id: agentId,
          tool_use_id: p.tool_use_id,
        });
        this.pushAgentStatus(agentId);
        break;
      }
    }
  }

  /**
   * Re-forward prompts already pending when this device (re)subscribes so a
   * late-joining or reconnected device can answer them; without this the reply
   * is rejected as "no such outstanding prompt" since `outstandingPermissions`
   * is per-connection and only filled by live events.
   */
  private replayPendingPermissions(agentId: string): void {
    const pending = appState.agentPendingPermissions.get(agentId);
    if (!pending) {
      return;
    }
    for (const p of pending.values()) {
      this.ctx.outstandingPermissions.add(
        permissionKey(agentId, p.tool_use_id),
      );
      this.pushEvent("permission.request", agentId, {
        agent_id: agentId,
        tool_use_id: p.tool_use_id,
        tool_name: p.tool_name,
        tool_input: p.tool_input,
      });
    }
  }

  /** Re-publish an agent's status so `awaiting` tracks prompts appearing and
   *  being answered, not just runner state changes. */
  private pushAgentStatus(agentId: string): void {
    const agent = appState.agents.get(agentId);
    if (agent) {
      this.pushEvent("agent.status", agentId, toRemoteAgentStatus(agent));
    }
  }

  private pushEvent(
    event: RemoteEventType,
    agentId: string | null,
    payload: unknown,
  ): void {
    // Validate our own outgoing payload against the shared schema — a bug that
    // leaks an unexpected field is caught here rather than shipped.
    const schema = EventPayloads[event];
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    this.emit({
      type: "evt",
      seq: this.nextSeq(),
      event,
      agent_id: agentId,
      payload: parsed.data,
    });
  }

  private nextSeq(): number {
    return this.sendSeq++;
  }

  private emit(envelope: Envelope): void {
    const json = encoder.encode(JSON.stringify(envelope));
    const plain = new Uint8Array(1 + json.length);
    plain[0] = TAG_JSON;
    plain.set(json, 1);
    this.sink(this.session.encrypt(plain));
  }

  /** Send a binary media message (config/frame) on the same encrypted channel. */
  private emitMedia(body: Uint8Array): void {
    const plain = new Uint8Array(1 + body.length);
    plain[0] = TAG_MEDIA;
    plain.set(body, 1);
    this.sink(this.session.encrypt(plain));
  }

  /** Send one transfer chunk on the same encrypted channel. */
  private emitXfer(body: Uint8Array): void {
    const plain = new Uint8Array(1 + body.length);
    plain[0] = TAG_XFER;
    plain.set(body, 1);
    this.sink(this.session.encrypt(plain));
  }
}

// --- Registry + broadcast tap ----------------------------------------------

const connections = new Set<DeviceConnection>();
let untap: (() => void) | null = null;

/** Notified whenever the live connection set changes (connect/disconnect). */
let connectionsChanged: (() => void) | null = null;
export function setConnectionsChangedListener(cb: (() => void) | null): void {
  connectionsChanged = cb;
}

/** Device IDs with a live connection right now. */
export function getConnectedDeviceIds(): string[] {
  return [...new Set([...connections].map((c) => c.device.device_id))];
}

/** Register a live device connection so it receives forwarded events. */
export function addConnection(conn: DeviceConnection): void {
  connections.add(conn);
  if (!untap) {
    untap = addHostEventSink((channel, args) => {
      for (const c of connections) {
        c.handleBroadcast(channel, args);
      }
    });
  }
  connectionsChanged?.();
}

export function removeConnection(conn: DeviceConnection): void {
  conn.dispose();
  connections.delete(conn);
  if (connections.size === 0 && untap) {
    untap();
    untap = null;
  }
  connectionsChanged?.();
}

/** Close any live connection for a device (called on revoke). */
export function disconnectDevice(deviceId: string): void {
  for (const c of connections) {
    if (c.device.device_id === deviceId) {
      c.close();
    }
  }
}

/**
 * Announce the desktop's addresses to every live device. Called when a tunnel
 * comes up or dies so phones learn new routes without re-pairing.
 */
export function broadcastEndpoints(endpoints: RemoteEndpoint[]): void {
  for (const c of connections) {
    c.pushEndpoints(endpoints);
  }
}

/** Drop every connection (kill-switch / shutdown). */
export function clearConnections(): void {
  for (const c of connections) {
    c.dispose();
  }
  connections.clear();
  if (untap) {
    untap();
    untap = null;
  }
}
