/**
 * JSON-RPC peer for `codex app-server`: one JSON object per line over stdio,
 * `{ id, method, params }` without the `jsonrpc` field. Both sides send
 * requests — the server asks for approvals the same way we ask for turns.
 */

import readline from "node:readline";
import type { Readable, Writable } from "node:stream";

export type RpcId = number | string;

export interface RpcRequest {
  id: RpcId;
  method: string;
  params: unknown;
}

export interface RpcNotification {
  method: string;
  params: unknown;
}

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: string) => void;
}

export class CodexRpc {
  private nextId = 1;
  private readonly pending = new Map<RpcId, Pending>();
  private closed = false;

  constructor(
    private readonly stdin: Writable,
    stdout: Readable,
    private readonly handlers: {
      notification: (n: RpcNotification) => void;
      request: (r: RpcRequest) => void;
      /** A line that isn't JSON-RPC — logged, never fatal. */
      malformed: (line: string) => void;
    },
  ) {
    const rl = readline.createInterface({ input: stdout, crlfDelay: Infinity });
    rl.on("line", (line) => this.onLine(line));
  }

  request<T>(method: string, params: unknown): Promise<T> {
    if (this.closed) {
      return Promise.reject(`codex app-server is not running (${method})`);
    }
    const id = this.nextId++;

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (r) => resolve(r as T),
        reject,
      });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  respond(id: RpcId, result: unknown): void {
    this.write({ id, result });
  }

  respondError(id: RpcId, message: string): void {
    this.write({ id, error: { code: -32603, message } });
  }

  /** Reject everything in flight; later requests fail fast. */
  close(reason: string): void {
    this.closed = true;
    for (const p of this.pending.values()) {
      p.reject(reason);
    }
    this.pending.clear();
  }

  private write(message: object): void {
    if (this.closed || this.stdin.destroyed || this.stdin.writableEnded) {
      return;
    }
    this.stdin.write(JSON.stringify(message) + "\n");
  }

  private onLine(line: string): void {
    if (!line.trim()) {
      return;
    }
    let msg: {
      id?: RpcId;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { message?: string };
    };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      this.handlers.malformed(line);

      return;
    }
    if (typeof msg.method === "string") {
      if (msg.id !== undefined) {
        this.handlers.request({
          id: msg.id,
          method: msg.method,
          params: msg.params,
        });
      } else {
        this.handlers.notification({ method: msg.method, params: msg.params });
      }

      return;
    }
    if (msg.id === undefined) {
      this.handlers.malformed(line);

      return;
    }
    const pending = this.pending.get(msg.id);
    if (!pending) {
      return;
    }
    this.pending.delete(msg.id);
    if (msg.error) {
      pending.reject(msg.error.message ?? "codex app-server request failed");
    } else {
      pending.resolve(msg.result);
    }
  }
}
