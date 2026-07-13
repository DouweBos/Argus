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
import {
  Envelope,
  EventPayloads,
  type RemoteEventType,
} from "@argus/remote-protocol";
import { addBroadcastTap } from "../../broadcast";
import { appState } from "../../state";
import {
  dispatch,
  GatewayError,
  permissionKey,
  toRemoteAgentCapabilities,
  toRemoteAgentStatus,
  type GatewayContext,
} from "./capabilities";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
export class DeviceConnection {
  private sendSeq = 0;
  private recvSeq = -1;
  private readonly subscriptions = new Set<string>();
  private readonly ctx: GatewayContext;
  private closer: (() => void) | null = null;

  constructor(
    readonly device: PairedDevice,
    private readonly session: NoiseSession,
    private readonly sink: (bytes: Uint8Array) => void,
  ) {
    this.ctx = { device, outstandingPermissions: new Set() };
  }

  /** Register how to tear down the underlying socket (set by the server). */
  setCloser(fn: () => void): void {
    this.closer = fn;
  }

  close(): void {
    this.closer?.();
  }

  /** Handle one encrypted inbound frame from the transport. */
  async onFrame(cipher: Uint8Array): Promise<void> {
    let envelope: Envelope;
    try {
      const plain = decoder.decode(this.session.decrypt(cipher));
      envelope = Envelope.parse(JSON.parse(plain));
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
      const ok = await dispatch(method, params, this.ctx);
      this.emit({ type: "res", seq: this.nextSeq(), id, ok });
    } catch (err) {
      const code =
        err instanceof GatewayError ? err.code : ("internal" as const);
      const message = err instanceof Error ? err.message : "error";
      this.emit({
        type: "res",
        seq: this.nextSeq(),
        id,
        error: { code, message },
      });
    }
  }

  /** Forward a tapped renderer broadcast to this device, if relevant. */
  handleBroadcast(channel: string, args: unknown[]): void {
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
        break;
      }
      case "permission-cancel": {
        const p = args[0] as { tool_use_id: string };
        this.ctx.outstandingPermissions.delete(
          permissionKey(agentId, p.tool_use_id),
        );
        this.pushEvent("permission.cancel", agentId, {
          agent_id: agentId,
          tool_use_id: p.tool_use_id,
        });
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
    const plain = encoder.encode(JSON.stringify(envelope));
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
    untap = addBroadcastTap((channel, args) => {
      for (const c of connections) {
        c.handleBroadcast(channel, args);
      }
    });
  }
  connectionsChanged?.();
}

export function removeConnection(conn: DeviceConnection): void {
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

/** Drop every connection (kill-switch / shutdown). */
export function clearConnections(): void {
  connections.clear();
  if (untap) {
    untap();
    untap = null;
  }
}
