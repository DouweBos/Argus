import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HANDOFF_SCRIPT,
  appBundleFromExecPath,
  compareVersions,
  designatedRequirementMatches,
  nativeAppcastUrl,
  nativeBundleProblem,
  parseNewestAppcastItem,
  shouldOfferNative,
} from "./serverHandoffModel";

const APPCAST = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Argus Server</title>
    <item>
      <title>0.41.0</title>
      <sparkle:version>410</sparkle:version>
      <sparkle:shortVersionString>0.41.0</sparkle:shortVersionString>
      <enclosure url="https://example.com/old.zip" length="100" type="application/octet-stream" sparkle:edSignature="abc"/>
    </item>
    <item>
      <title>0.42.0</title>
      <sparkle:version>420</sparkle:version>
      <sparkle:shortVersionString>0.42.0</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>15.0</sparkle:minimumSystemVersion>
      <enclosure url="https://example.com/a.zip?x=1&amp;y=2" length="12345" type="application/octet-stream" sparkle:edSignature="def"/>
    </item>
  </channel>
</rss>`;

describe("parseNewestAppcastItem", () => {
  it("picks the highest build regardless of order", () => {
    expect(parseNewestAppcastItem(APPCAST)).toEqual({
      version: "420",
      shortVersion: "0.42.0",
      url: "https://example.com/a.zip?x=1&y=2",
      length: 12345,
      minimumSystemVersion: "15.0",
    });
  });

  it("reads Sparkle 1 enclosure attributes", () => {
    const xml = `<item><enclosure sparkle:version="7" sparkle:shortVersionString="1.0.0" url="https://e.com/z.zip" /></item>`;
    expect(parseNewestAppcastItem(xml)).toMatchObject({
      version: "7",
      shortVersion: "1.0.0",
      length: null,
    });
  });

  it("skips items without an https enclosure", () => {
    const xml = `<item><sparkle:version>9</sparkle:version><enclosure url="http://e.com/z.zip"/></item><item><sparkle:version>9</sparkle:version></item>`;
    expect(parseNewestAppcastItem(xml)).toBeNull();
    expect(parseNewestAppcastItem("not xml")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders numerically with prereleases below releases", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0-beta.2", "1.2.0")).toBe(-1);
    expect(compareVersions("1.2.0-beta.10", "1.2.0-beta.9")).toBe(1);
    expect(compareVersions("v2.0.0", "1.9.0")).toBe(1);
  });
});

describe("shouldOfferNative", () => {
  const item = parseNewestAppcastItem(APPCAST);
  if (!item) {
    throw new Error("fixture did not parse");
  }

  it("offers the same version, since it is a different product", () => {
    expect(shouldOfferNative(item, "0.42.0", "15.1")).toBe(true);
    expect(shouldOfferNative(item, "0.41.3", "15.1")).toBe(true);
  });

  it("does not offer an older build or one the OS can't run", () => {
    expect(shouldOfferNative(item, "0.43.0", "15.1")).toBe(false);
    expect(shouldOfferNative(item, "0.42.0", "14.6")).toBe(false);
  });
});

describe("bundle checks", () => {
  it("requires our identifier and team in the designated requirement", () => {
    const dr = `designated => identifier "dev.houwert.argus.server" and anchor apple generic and certificate leaf[subject.OU] = CKZT75PN5T`;
    expect(designatedRequirementMatches(dr)).toBe(true);
    expect(
      designatedRequirementMatches(dr.replace("argus.server", "argus")),
    ).toBe(false);
    expect(designatedRequirementMatches(dr.replace("CKZT75PN5T", "X"))).toBe(
      false,
    );
  });

  it("tells the native bundle from the Electron one", () => {
    const native = {
      CFBundleIdentifier: "dev.houwert.argus.server",
      LSUIElement: true,
    };
    expect(nativeBundleProblem(native, false)).toBeNull();
    expect(nativeBundleProblem(native, true)).not.toBeNull();
    expect(
      nativeBundleProblem({ ...native, ElectronAsarIntegrity: {} }, false),
    ).not.toBeNull();
    expect(
      nativeBundleProblem({ ...native, LSUIElement: false }, false),
    ).not.toBeNull();
    expect(
      nativeBundleProblem(
        { ...native, CFBundleIdentifier: "dev.houwert.argus" },
        false,
      ),
    ).not.toBeNull();
  });
});

describe("appBundleFromExecPath", () => {
  it("climbs out of Contents/MacOS", () => {
    expect(
      appBundleFromExecPath(
        "/Applications/Argus Server.app/Contents/MacOS/Argus Server",
      ),
    ).toBe("/Applications/Argus Server.app");
    expect(
      appBundleFromExecPath("/usr/local/bin/node/Contents/MacOS/x"),
    ).toBeNull();
    expect(appBundleFromExecPath("/usr/bin/electron")).toBeNull();
  });
});

describe("handoff", () => {
  it("names the channel's appcast", () => {
    expect(nativeAppcastUrl("beta")).toBe(
      "https://houwert.dev/argus/updates/argus-server-beta.xml",
    );
  });
});

/** Runs the real script against temp dirs, with `open` stubbed out on PATH. */
describe.runIf(process.platform === "darwin")("the hand-off script", () => {
  function setup(): Record<string, string> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-"));
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, "open"),
      `#!/bin/sh\necho "$1" > "${root}/opened"\n`,
      { mode: 0o755 },
    );
    const old = path.join(root, "Apps", "Argus Server.app");
    const tmp = path.join(root, "tmp");
    const fresh = path.join(tmp, "Argus Server.app");
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, "marker"), "electron");
    fs.mkdirSync(fresh, { recursive: true });
    fs.writeFileSync(path.join(fresh, "marker"), "native");

    return {
      root,
      bin,
      old,
      tmp,
      fresh,
      backup: path.join(root, "Argus Server (Electron).app"),
    };
  }

  function run(d: Record<string, string>, fresh = d.fresh): number {
    const result = spawnSync(
      "/bin/sh",
      ["-c", HANDOFF_SCRIPT, "sh", "999999", d.old, fresh, d.backup, d.tmp],
      { env: { ...process.env, PATH: `${d.bin}:/usr/bin:/bin` } },
    );

    return result.status ?? -1;
  }

  it("swaps the bundle, keeps the old one aside and opens the new one", () => {
    const d = setup();
    expect(run(d)).toBe(0);
    expect(fs.readFileSync(path.join(d.old, "marker"), "utf8")).toBe("native");
    expect(fs.readFileSync(path.join(d.backup, "marker"), "utf8")).toBe(
      "electron",
    );
    expect(fs.existsSync(d.tmp)).toBe(false);
    expect(fs.readFileSync(path.join(d.root, "opened"), "utf8").trim()).toBe(
      d.old,
    );
  });

  it("puts the old bundle back when the copy fails", () => {
    const d = setup();
    expect(run(d, path.join(d.root, "missing.app"))).toBe(1);
    expect(fs.readFileSync(path.join(d.old, "marker"), "utf8")).toBe(
      "electron",
    );
    expect(fs.existsSync(path.join(d.root, "opened"))).toBe(true);
  });
});
