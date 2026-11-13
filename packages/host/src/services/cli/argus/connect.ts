/** The `argus` CLI's real I/O: the host's MCP server, git, stdin. */

import type { ToolResult } from "./run";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { readEndpointFile } from "../../mcp/endpointFile";

const run = promisify(execFile);

export class HostUnreachable extends Error {}

export interface HostConnection {
  call: (tool: string, args: Record<string, unknown>) => Promise<ToolResult>;
  close: () => Promise<void>;
}

export async function connectToHost(): Promise<HostConnection> {
  const endpoint = readEndpointFile();
  if (!endpoint) {
    throw new HostUnreachable(
      "Argus isn't running (no MCP endpoint in ARGUS_HOME). Open Argus and try again.",
    );
  }
  const transport = new StreamableHTTPClientTransport(new URL(endpoint.url), {
    requestInit: {
      headers: {
        authorization: `Bearer ${endpoint.token}`,
        "x-argus-client": "cli",
      },
    },
  });
  const client = new Client({ name: "argus-cli", version: "1.0.0" });
  try {
    await client.connect(transport);
  } catch (e) {
    throw new HostUnreachable(
      `couldn't reach Argus at ${endpoint.url}: ${(e as Error).message}`,
    );
  }

  return {
    call: async (tool, args) => {
      const res = await client.callTool({ name: tool, arguments: args });
      const content = (res.content ?? []) as { type: string; text?: string }[];

      return {
        isError: res.isError === true,
        text: content
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n"),
      };
    },
    close: () => client.close(),
  };
}

/** The main checkout `dir` belongs to, even from inside one of its worktrees. */
export async function projectRoot(dir: string): Promise<string> {
  const abs = path.resolve(dir);
  try {
    const { stdout } = await run("git", [
      "-C",
      abs,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);
    const common = stdout.trim();
    if (path.basename(common) === ".git") {
      return path.dirname(common);
    }
    const top = await run("git", ["-C", abs, "rev-parse", "--show-toplevel"]);

    return top.stdout.trim();
  } catch {
    throw new Error(`${abs} isn't inside a git repository`);
  }
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks).toString("utf-8");
}
