import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listPluginMcpServers } from "./pluginServers";

let home: string;

function write(rel: string, data: unknown) {
  const file = path.join(home, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
}

const server = (url: string) => ({
  mcpServers: { [url]: { type: "http", url } },
});

describe("listPluginMcpServers", () => {
  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), "plugin-servers-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("lists installed and organization-synced plugins", () => {
    const installPath = path.join(home, ".claude/plugins/cache/tools/1.0.0");
    write(".claude/settings.json", {
      enabledPlugins: { "tools@market": true },
    });
    write(".claude/plugins/installed_plugins.json", {
      plugins: { "tools@market": [{ installPath }] },
    });
    write(".claude/plugins/cache/tools/1.0.0/.mcp.json", server("figma"));
    write(".claude/plugins/synced/org/manifest.json", {
      plugins: [{ name: "plex-tools", generation: 2 }, { name: "gone" }],
    });
    write(
      ".claude/plugins/synced/org/plex-tools~g2/.mcp.json",
      server("linear"),
    );

    expect(listPluginMcpServers(home).map((s) => [s.name, s.plugin])).toEqual([
      ["figma", "tools@market"],
      ["linear", "plex-tools"],
    ]);
  });

  it("finds a synced plugin without a generation suffix", () => {
    write(".claude/plugins/synced/org/manifest.json", {
      plugins: [{ name: "plex-tools" }],
    });
    write(".claude/plugins/synced/org/plex-tools/.mcp.json", server("wiki"));

    expect(listPluginMcpServers(home).map((s) => s.name)).toEqual(["wiki"]);
  });

  it("skips a synced plugin that is switched off or already installed", () => {
    write(".claude/settings.json", {
      enabledPlugins: { "off@synced": false, "plex-tools@market": true },
    });
    write(".claude/plugins/installed_plugins.json", {
      plugins: {
        "plex-tools@market": [{ installPath: path.join(home, "installed") }],
      },
    });
    write("installed/.mcp.json", server("linear"));
    write(".claude/plugins/synced/org/manifest.json", {
      plugins: [{ name: "off" }, { name: "plex-tools" }],
    });
    write(".claude/plugins/synced/org/off/.mcp.json", server("statsig"));
    write(".claude/plugins/synced/org/plex-tools/.mcp.json", server("linear"));

    expect(listPluginMcpServers(home).map((s) => [s.name, s.plugin])).toEqual([
      ["linear", "plex-tools@market"],
    ]);
  });
});
