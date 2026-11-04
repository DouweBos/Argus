/**
 * A stand-in for the host core that the Mac app attaches to as a window
 * (`ARGUS_ATTACH_HOME`): the local UI socket's framing and envelopes, answered
 * from a fixture scenario instead of real sessions and agents.
 *
 * It owns nothing and spawns nothing — every reply is canned, so a capture is
 * the same run to run and nothing on this machine is read or touched.
 */

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { z } from "zod";
import {
  COMMANDS,
  LOCAL_UI_PROTOCOL,
  MethodResult,
} from "@argus/remote-protocol";
import { synthesize } from "./synth";

/** Answers one request; `undefined` falls through to the schema default. */
export type Resolver = (
  method: string,
  params: Record<string, unknown>,
) => unknown;

export interface FixtureHost {
  /** Every method asked for, in order — what a scenario is missing shows up here. */
  calls: string[];
  close: () => Promise<void>;
  /** A raw broadcast, as `emitHostEvent(channel, payload)` would send it. */
  ipc: (channel: string, payload: unknown) => void;
  /** A typed event (`agent.transcript`, `sessions.changed`, …). */
  push: (event: string, agentId: string | null, payload: unknown) => void;
  /** Agents the app subscribed to; typed agent events only reach these. */
  subscriptions: Set<string>;
}

const TAG_JSON = 0x00;

function frame(envelope: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(envelope));
  const out = Buffer.alloc(5 + json.length);
  out.writeUInt32BE(json.length + 1, 0);
  out[4] = TAG_JSON;
  json.copy(out, 5);

  return out;
}

function fallback(method: string): unknown {
  const typed = (MethodResult as Record<string, z.ZodType>)[method];
  if (typed) {
    return synthesize(typed);
  }
  const command = (COMMANDS as Record<string, { result: z.ZodType }>)[method];

  return command ? synthesize(command.result) : null;
}

export async function startFixtureHost(
  home: string,
  resolve: Resolver,
): Promise<FixtureHost> {
  fs.mkdirSync(home, { recursive: true });
  const socketPath = path.join(home, "host.sock");
  fs.rmSync(socketPath, { force: true });

  const calls: string[] = [];
  const subscriptions = new Set<string>();
  const sockets = new Set<net.Socket>();
  let seq = 0;

  const send = (envelope: Record<string, unknown>) => {
    seq += 1;
    const bytes = frame({ ...envelope, seq });
    for (const socket of sockets) {
      socket.write(bytes);
    }
  };

  const answer = async (
    socket: net.Socket,
    request: Record<string, unknown>,
  ) => {
    const method = String(request.method);
    calls.push(method);
    const params = (request.params ?? {}) as Record<string, unknown>;
    let ok: unknown;
    try {
      ok = method.startsWith("ui.") ? {} : await resolve(method, params);
    } catch (err) {
      seq += 1;
      socket.write(
        frame({
          type: "res",
          seq,
          id: request.id,
          error: { code: "bad_request", message: String(err) },
        }),
      );

      return;
    }
    seq += 1;
    socket.write(
      frame({
        type: "res",
        seq,
        id: request.id,
        ok: ok === undefined ? fallback(method) : ok,
      }),
    );
  };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (buffer.length < 4 + length) {
          return;
        }
        const body = buffer.subarray(4, 4 + length);
        buffer = buffer.subarray(4 + length);
        if (body[0] !== TAG_JSON) {
          continue;
        }
        const envelope = JSON.parse(body.subarray(1).toString()) as Record<
          string,
          unknown
        >;
        if (envelope.type === "sub") {
          const agentId = String(envelope.agent_id);
          if (envelope.action === "subscribe") {
            subscriptions.add(agentId);
          } else {
            subscriptions.delete(agentId);
          }
        } else if (envelope.type === "req") {
          answer(socket, envelope).catch(() => undefined);
        }
      }
    });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  });
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(socketPath, () => done());
  });
  fs.chmodSync(socketPath, 0o600);

  // What `advertiseHostSocket` writes: the app attaches to whoever holds this.
  const lock = path.join(home, "host.lock");
  fs.writeFileSync(
    lock,
    JSON.stringify({
      pid: process.pid,
      owner_pid: process.pid,
      owner: "cli",
      started_at: Date.now(),
      socket: socketPath,
      protocol: LOCAL_UI_PROTOCOL,
    }),
  );

  return {
    calls,
    subscriptions,
    ipc: (channel, payload) =>
      send({
        type: "evt",
        event: "ipc",
        agent_id: null,
        payload: { channel, args: [payload] },
      }),
    push: (event, agentId, payload) =>
      send({ type: "evt", event, agent_id: agentId, payload }),
    close: () =>
      new Promise<void>((done) => {
        fs.rmSync(lock, { force: true });
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => done());
        fs.rmSync(socketPath, { force: true });
      }),
  };
}
