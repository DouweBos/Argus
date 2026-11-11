import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("../integrations/service", () => ({
  linearApi: () => ({}),
  linearIssueContext: async () => ({
    context: "# ENG-1 Checkout",
    images: [{ data: "shot", media_type: "image/png" }],
    designUrls: ["https://www.figma.com/design/FILE/App?node-id=5-6"],
  }),
}));
vi.mock("../integrations/figma/service", () => ({
  figmaApi: () => null,
  cachedFigmaFrame: () => null,
}));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

const { registerIntegrationTools } = await import("./integrationTools");

describe("linear_get_issue", () => {
  it("lists linked Figma frames as text and embeds only the issue's own screenshots", async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    registerIntegrationTools(server, null);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "caller", version: "1.0.0" });
    await client.connect(clientTransport);
    const result = await client.callTool({
      name: "linear_get_issue",
      arguments: { ref: "ENG-1" },
    });
    await client.close();

    const content = result.content as { type: string; text?: string }[];
    expect(content.map((c) => c.type)).toEqual(["text", "text", "image"]);
    expect(content[1]!.text).toContain("file `FILE`, node `5:6`");
  });
});
