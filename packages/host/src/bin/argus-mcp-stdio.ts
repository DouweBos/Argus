/**
 * `argus-mcp-stdio` — a stdio MCP server for agents that can't speak HTTP MCP,
 * forwarding to the HTTP server in `ARGUS_MCP_BRIDGE_URL`. Headers come from
 * the environment rather than argv so the token stays out of `ps`.
 */

import {
  BRIDGE_HEADERS_ENV,
  BRIDGE_URL_ENV,
  runStdioBridge,
} from "../services/mcp/stdioBridge";

const url = process.env[BRIDGE_URL_ENV];
if (!url) {
  process.stderr.write(`argus-mcp-stdio: ${BRIDGE_URL_ENV} is not set\n`);
  process.exit(2);
}

runStdioBridge({
  url,
  headers: JSON.parse(process.env[BRIDGE_HEADERS_ENV] || "{}") as Record<
    string,
    string
  >,
  input: process.stdin,
  output: process.stdout,
}).then(() => process.exit(0));
