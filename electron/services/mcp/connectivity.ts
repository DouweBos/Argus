/**
 * Probe MCP server connectivity by performing the JSON-RPC `initialize`
 * handshake. Used by the Settings UI to surface "is this server reachable?"
 * without spawning a full agent.
 *
 * Supports two transports:
 * - HTTP (streamable transport): POST initialize, accept JSON or SSE response.
 * - stdio: spawn the configured command and exchange newline-delimited
 *   JSON-RPC over stdin/stdout.
 */

import { spawn, type ChildProcess } from "node:child_process";

const PROTOCOL_VERSION = "2025-06-18";
const REQUEST_TIMEOUT_MS = 8_000;

export type McpTransport = "http" | "stdio" | "unknown";

export interface McpTestResult {
  ok: boolean;
  transport: McpTransport;
  latencyMs?: number;
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
  error?: string;
}

interface JsonRpcResponse {
  id?: number;
  result?: {
    protocolVersion?: string;
    serverInfo?: { name?: string; version?: string };
  };
  error?: { code?: number; message?: string };
}

function buildInitRequest(id: number) {
  return {
    jsonrpc: "2.0" as const,
    id,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "argus-mcp-test", version: "1.0" },
    },
  };
}

/**
 * Pull the first JSON-RPC payload out of an SSE response body. Streamable
 * HTTP servers wrap the response in `data:` frames; everything else we
 * treat as plain JSON.
 */
function parseSseFirstJson(body: string): JsonRpcResponse | null {
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    try {
      return JSON.parse(data) as JsonRpcResponse;
    } catch {
      // Try the next data frame.
    }
  }

  return null;
}

async function testHttp(
  url: string,
  headers: Record<string, string>,
): Promise<McpTestResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(buildInitRequest(1)),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return {
        ok: false,
        transport: "http",
        latencyMs,
        error: `HTTP ${res.status} ${res.statusText || ""}`.trim(),
      };
    }

    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    let payload: JsonRpcResponse | null = null;
    if (ct.includes("text/event-stream")) {
      payload = parseSseFirstJson(await res.text());
    } else {
      try {
        payload = (await res.json()) as JsonRpcResponse;
      } catch (err) {
        return {
          ok: false,
          transport: "http",
          latencyMs,
          error: `invalid JSON response: ${(err as Error).message}`,
        };
      }
    }

    if (!payload) {
      return {
        ok: false,
        transport: "http",
        latencyMs,
        error: "empty or unrecognized response",
      };
    }
    if (payload.error) {
      const msg = payload.error.message ?? JSON.stringify(payload.error);

      return {
        ok: false,
        transport: "http",
        latencyMs,
        error: `JSON-RPC error: ${msg}`,
      };
    }

    return {
      ok: true,
      transport: "http",
      latencyMs,
      protocolVersion: payload.result?.protocolVersion,
      serverInfo: payload.result?.serverInfo,
    };
  } catch (err) {
    clearTimeout(timer);
    const e = err as Error;
    const message =
      e.name === "AbortError"
        ? `timed out after ${REQUEST_TIMEOUT_MS}ms`
        : e.message;

    return { ok: false, transport: "http", error: message };
  }
}

async function testStdio(
  command: string,
  args: string[],
  env: Record<string, string>,
  cwd: string | undefined,
): Promise<McpTestResult> {
  const start = Date.now();

  return new Promise<McpTestResult>((resolve) => {
    let settled = false;
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...env },
        cwd,
      });
    } catch (err) {
      resolve({
        ok: false,
        transport: "stdio",
        error: (err as Error).message,
      });

      return;
    }

    const finish = (r: McpTestResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      try {
        child.kill();
      } catch {
        // Best-effort cleanup.
      }
      resolve(r);
    };

    const timeout = setTimeout(
      () =>
        finish({
          ok: false,
          transport: "stdio",
          error: `timed out after ${REQUEST_TIMEOUT_MS}ms`,
        }),
      REQUEST_TIMEOUT_MS,
    );

    let stderrBuf = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      if (stderrBuf.length > 4000) {
        stderrBuf = stderrBuf.slice(-2000);
      }
    });

    let stdoutBuf = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      let idx: number;
      while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (!line) {
          continue;
        }
        let msg: JsonRpcResponse;
        try {
          msg = JSON.parse(line) as JsonRpcResponse;
        } catch {
          continue;
        }
        if (msg.id !== 1) {
          continue;
        }
        const latencyMs = Date.now() - start;
        if (msg.error) {
          const m = msg.error.message ?? JSON.stringify(msg.error);
          finish({
            ok: false,
            transport: "stdio",
            latencyMs,
            error: `JSON-RPC error: ${m}`,
          });

          return;
        }
        finish({
          ok: true,
          transport: "stdio",
          latencyMs,
          protocolVersion: msg.result?.protocolVersion,
          serverInfo: msg.result?.serverInfo,
        });

        return;
      }
    });

    child.on("error", (err) => {
      finish({ ok: false, transport: "stdio", error: err.message });
    });
    child.on("exit", (code, signal) => {
      const tail = stderrBuf.trim().split("\n").slice(-3).join(" | ");
      let reason = "exited";
      if (code !== null) {
        reason = `exit ${code}`;
      } else if (signal) {
        reason = `signal ${signal}`;
      }
      finish({
        ok: false,
        transport: "stdio",
        error: tail ? `${reason}: ${tail}` : reason,
      });
    });

    try {
      child.stdin?.write(`${JSON.stringify(buildInitRequest(1))}\n`);
    } catch (err) {
      finish({
        ok: false,
        transport: "stdio",
        error: (err as Error).message,
      });
    }
  });
}

/**
 * Run a connectivity probe against an MCP server config. Same shape as the
 * entries inside `mcpServers` in `.mcp.json` / `.argus.json` / app settings.
 */
export async function testMcpServer(
  config: Record<string, unknown>,
): Promise<McpTestResult> {
  if (!config || typeof config !== "object") {
    return { ok: false, transport: "unknown", error: "missing config" };
  }
  const type =
    typeof config.type === "string" ? config.type.toLowerCase() : null;
  const url = typeof config.url === "string" ? config.url : null;
  const command = typeof config.command === "string" ? config.command : null;

  if (url && (type === "http" || type === "sse" || type === null)) {
    const headers =
      config.headers && typeof config.headers === "object"
        ? (config.headers as Record<string, string>)
        : {};

    return testHttp(url, headers);
  }

  if (command) {
    const args = Array.isArray(config.args)
      ? (config.args as unknown[]).map(String)
      : [];
    const env =
      config.env && typeof config.env === "object"
        ? (config.env as Record<string, string>)
        : {};
    const cwd = typeof config.cwd === "string" ? config.cwd : undefined;

    return testStdio(command, args, env, cwd);
  }

  return {
    ok: false,
    transport: "unknown",
    error: "config has neither `url` nor `command`",
  };
}
