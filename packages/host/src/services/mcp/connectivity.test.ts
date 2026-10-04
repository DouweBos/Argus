import { describe, expect, it } from "vitest";
import { testMcpServer } from "./connectivity";

/** A stdio server in one `node -e` script: answers initialize, optionally tools/list. */
function stdioServer(answersTools: boolean) {
  const script = `
    const rl = require("node:readline").createInterface({ input: process.stdin });
    const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
    rl.on("line", (line) => {
      const m = JSON.parse(line);
      if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "fake" } } });
      if (m.method === "tools/list" && ${answersTools}) send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "say_hello", description: "Hi" }] } });
    });`;

  return { command: process.execPath, args: ["-e", script] };
}

describe("testMcpServer over stdio", () => {
  it("lists the server's tools after initialize", async () => {
    const result = await testMcpServer(stdioServer(true));
    expect(result.ok).toBe(true);
    expect(result.serverInfo?.name).toBe("fake");
    expect(result.tools).toEqual([{ name: "say_hello", description: "Hi" }]);
  });

  it("stays ok when the server never answers tools/list", async () => {
    const result = await testMcpServer(stdioServer(false));
    expect(result.ok).toBe(true);
    expect(result.tools).toBeUndefined();
  });
});
