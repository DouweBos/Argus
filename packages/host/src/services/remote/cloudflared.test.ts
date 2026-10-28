/**
 * Installing the pinned `cloudflared`: only a download matching its checksum
 * is ever made executable, a user's own binary wins and is left alone, and a
 * failed download still falls back to one on PATH.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canInstallCloudflared,
  CLOUDFLARED_ASSETS,
  CLOUDFLARED_VERSION,
  CloudflaredInstallError,
  ensureCloudflared,
  findCloudflared,
  managedCloudflaredPath,
  type CloudflaredAsset,
} from "./cloudflared";

const SCRIPT = "#!/bin/sh\necho cloudflared version test\n";
const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

let dir: string;
let baseDir: string;

function serving(bytes: Uint8Array | string): typeof fetch {
  return vi.fn(
    async () =>
      new Response(typeof bytes === "string" ? bytes : Buffer.from(bytes)),
  ) as unknown as typeof fetch;
}

function asset(
  bytes: Uint8Array | string,
  archive: CloudflaredAsset["archive"] = "binary",
): Record<string, CloudflaredAsset> {
  return {
    "test-arch": {
      url: "https://example.test/cloudflared",
      sha256: sha(bytes),
      archive,
    },
  };
}

const base = () => ({
  baseDir,
  platformKey: "test-arch",
  env: { PATH: "" } as NodeJS.ProcessEnv,
});

describe("cloudflared", () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-cfd-install-"));
    baseDir = path.join(dir, "bin", "cloudflared");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("pins a checksum for every release it can download", () => {
    expect(CLOUDFLARED_VERSION).toMatch(/^\d{4}\.\d+\.\d+$/);
    for (const entry of Object.values(CLOUDFLARED_ASSETS)) {
      expect(entry.url).toContain(`/download/${CLOUDFLARED_VERSION}/`);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(canInstallCloudflared({ platformKey: "darwin-arm64" })).toBe(true);
    expect(canInstallCloudflared({ platformKey: "win32-x64" })).toBe(false);
  });

  it("installs a verified binary into the Argus home", async () => {
    const fetchImpl = serving(SCRIPT);

    const resolved = await ensureCloudflared({
      ...base(),
      fetchImpl,
      assets: asset(SCRIPT),
    });

    const expected = managedCloudflaredPath({ baseDir });
    expect(resolved).toEqual({
      path: expected,
      source: "managed",
      downloaded: true,
    });
    expect(execFileSync(expected).toString()).toContain("cloudflared version");
    // Installed once: the next call runs it without downloading.
    await expect(
      ensureCloudflared({ ...base(), fetchImpl, assets: asset(SCRIPT) }),
    ).resolves.toMatchObject({ downloaded: false, source: "managed" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("unpacks a tgz release", async () => {
    const src = path.join(dir, "src");
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, "cloudflared"), SCRIPT, { mode: 0o755 });
    const tgz = path.join(dir, "cloudflared.tgz");
    execFileSync("tar", ["-czf", tgz, "-C", src, "cloudflared"]);
    const bytes = new Uint8Array(fs.readFileSync(tgz));

    const resolved = await ensureCloudflared({
      ...base(),
      fetchImpl: serving(bytes),
      assets: asset(bytes, "tgz"),
    });

    expect(execFileSync(resolved.path).toString()).toContain(
      "cloudflared version",
    );
  });

  it("refuses a download that doesn't match its checksum", async () => {
    const pending = ensureCloudflared({
      ...base(),
      fetchImpl: serving("#!/bin/sh\necho tampered\n"),
      assets: asset(SCRIPT),
    });

    await expect(pending).rejects.toBeInstanceOf(CloudflaredInstallError);
    await expect(pending).rejects.toMatchObject({ reason: "checksum" });
    expect(fs.existsSync(managedCloudflaredPath({ baseDir }))).toBe(false);
  });

  it("falls back to a cloudflared on PATH when the download fails", async () => {
    const userBin = path.join(dir, "usr-bin");
    fs.mkdirSync(userBin);
    fs.writeFileSync(path.join(userBin, "cloudflared"), SCRIPT, {
      mode: 0o755,
    });
    const failing = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    await expect(
      ensureCloudflared({
        ...base(),
        env: { PATH: userBin },
        fetchImpl: failing,
        assets: asset(SCRIPT),
      }),
    ).resolves.toEqual({
      path: path.join(userBin, "cloudflared"),
      source: "path",
      downloaded: false,
    });
  });

  it("uses the user's own binary when ARGUS_CLOUDFLARED_PATH names one", async () => {
    const own = path.join(dir, "my-cloudflared");
    fs.writeFileSync(own, SCRIPT, { mode: 0o755 });
    const fetchImpl = serving(SCRIPT);

    await expect(
      ensureCloudflared({
        ...base(),
        env: { ARGUS_CLOUDFLARED_PATH: own, PATH: "" },
        fetchImpl,
        assets: asset(SCRIPT),
      }),
    ).resolves.toEqual({ path: own, source: "override", downloaded: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(
      ensureCloudflared({
        ...base(),
        env: { ARGUS_CLOUDFLARED_PATH: path.join(dir, "nope"), PATH: "" },
      }),
    ).rejects.toMatchObject({ reason: "override_missing" });
  });

  it("has no release for an unknown platform", async () => {
    await expect(
      ensureCloudflared({
        ...base(),
        platformKey: "plan9-mips",
        fetchImpl: serving(""),
      }),
    ).rejects.toMatchObject({ reason: "unsupported" });
  });

  it("drops older releases once the pin is installed", async () => {
    const old = path.join(baseDir, "2020.1.1");
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, "cloudflared"), SCRIPT, { mode: 0o755 });

    await ensureCloudflared({
      ...base(),
      fetchImpl: serving(SCRIPT),
      assets: asset(SCRIPT),
    });

    expect(fs.readdirSync(baseDir)).toEqual([CLOUDFLARED_VERSION]);
  });

  it("finds what would run without downloading anything", async () => {
    await expect(findCloudflared(base())).resolves.toBeNull();
    await ensureCloudflared({
      ...base(),
      fetchImpl: serving(SCRIPT),
      assets: asset(SCRIPT),
    });
    await expect(findCloudflared(base())).resolves.toEqual({
      path: managedCloudflaredPath({ baseDir }),
      source: "managed",
    });
  });
});
