/**
 * A stdio MCP server that forwards every message to a Streamable HTTP MCP
 * server, so agents that only speak stdio MCP still reach Argus's tools.
 * Plain `node:http` on purpose: fetch's 5-minute body timeout would cut off
 * long tool calls like `wait_for_agent`.
 */

import type { IncomingMessage } from "node:http";
import http from "node:http";
import https from "node:https";
import readline from "node:readline";
import type { Readable, Writable } from "node:stream";

export const BRIDGE_URL_ENV = "ARGUS_MCP_BRIDGE_URL";
export const BRIDGE_HEADERS_ENV = "ARGUS_MCP_BRIDGE_HEADERS";

export interface StdioBridgeOptions {
  url: string;
  headers: Record<string, string>;
  input: Readable;
  output: Writable;
}

interface JsonRpc {
  id?: number | string | null;
  method?: string;
  result?: { protocolVersion?: string };
}

/** Resolves once stdin closes and the HTTP session is ended. */
export async function runStdioBridge(opts: StdioBridgeOptions): Promise<void> {
  const target = new URL(opts.url);
  let sessionId: string | null = null;
  let protocolVersion: string | null = null;
  // Requests after `initialize` need its session id, so they wait for it.
  let initialized: Promise<void> = Promise.resolve();

  const write = (msg: unknown): void => {
    opts.output.write(`${JSON.stringify(msg)}\n`);
  };

  const deliver = (raw: string): void => {
    const parsed = JSON.parse(raw) as JsonRpc | JsonRpc[];
    for (const msg of Array.isArray(parsed) ? parsed : [parsed]) {
      if (msg.result?.protocolVersion && !protocolVersion) {
        protocolVersion = msg.result.protocolVersion;
      }
      write(msg);
    }
  };

  const request = (
    method: "DELETE" | "POST",
    body?: string,
  ): Promise<IncomingMessage> =>
    new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        ...opts.headers,
        accept: "application/json, text/event-stream",
      };
      if (body !== undefined) {
        headers["content-type"] = "application/json";
      }
      if (sessionId) {
        headers["mcp-session-id"] = sessionId;
      }
      if (protocolVersion) {
        headers["mcp-protocol-version"] = protocolVersion;
      }
      const req = (target.protocol === "https:" ? https : http).request(
        target,
        { method, headers },
        resolve,
      );
      req.on("error", reject);
      req.end(body);
    });

  const forward = async (line: string, msg: JsonRpc): Promise<void> => {
    const isRequest = msg.method !== undefined && msg.id != null;
    const fail = (message: string): void => {
      if (isRequest) {
        write({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message } });
      }
    };

    try {
      if (msg.method !== "initialize") {
        await initialized;
      }
      const res = await request("POST", line);
      const sid = res.headers["mcp-session-id"];
      if (typeof sid === "string") {
        sessionId = sid;
      }
      const status = res.statusCode ?? 0;
      if (status === 202 || status === 204) {
        res.resume();

        return;
      }
      if (status >= 400) {
        fail(`MCP server answered ${status}: ${await text(res)}`);

        return;
      }
      const type = String(res.headers["content-type"] ?? "");
      if (type.includes("text/event-stream")) {
        await readSse(res, deliver);
      } else {
        const body = await text(res);
        if (body.trim()) {
          deliver(body);
        }
      }
    } catch (e) {
      fail(`MCP bridge: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const lines = readline.createInterface({ input: opts.input });
  lines.on("line", (line) => {
    let msg: JsonRpc;
    try {
      msg = JSON.parse(line) as JsonRpc;
    } catch {
      return;
    }
    const task = forward(line, msg);
    if (msg.method === "initialize") {
      initialized = task;
    }
  });
  await new Promise<void>((resolve) => lines.once("close", resolve));
  // The agent hung up: nobody is left to read pending answers.
  if (sessionId) {
    await request("DELETE")
      .then((res) => res.resume())
      .catch(() => undefined);
  }
}

function text(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => (body += chunk));
    res.on("end", () => resolve(body));
    res.on("error", reject);
  });
}

/** Hands each SSE event's `data` to `onData` until the stream ends. */
function readSse(
  res: IncomingMessage,
  onData: (data: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let data: string[] = [];
    const flush = (): void => {
      if (data.length > 0) {
        const payload = data.join("\n");
        data = [];
        try {
          onData(payload);
        } catch {
          // A malformed event shouldn't take the stream down.
        }
      }
    };
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (line === "") {
          flush();
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
    });
    res.on("end", () => {
      flush();
      resolve();
    });
    res.on("error", reject);
  });
}
