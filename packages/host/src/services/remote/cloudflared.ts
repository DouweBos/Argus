/**
 * The `cloudflared` binary behind the managed tunnel (and a huddle's quick
 * tunnel). Pinned: a known release, downloaded on first need into the Argus
 * home and checked against its SHA-256 before it may run. Bumping the pin
 * (version, URLs, checksums) is the whole upgrade.
 *
 * `ARGUS_CLOUDFLARED_PATH` points at a binary of the user's own instead, which
 * is never replaced. A `cloudflared` on PATH is only the fallback when the
 * download can't happen.
 */

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  chmod,
  constants,
  mkdir,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { argusHomeDir } from "../../lib/argusHome";

const execFileAsync = promisify(execFile);

export const CLOUDFLARED_VERSION = "2026.10.4";
const OVERRIDE_ENV = "ARGUS_CLOUDFLARED_PATH";
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const RELEASES = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}`;

export interface CloudflaredAsset {
  url: string;
  sha256: string;
  archive: "binary" | "tgz";
}

export const CLOUDFLARED_ASSETS: Record<string, CloudflaredAsset> = {
  "darwin-arm64": {
    url: `${RELEASES}/cloudflared-darwin-arm64.tgz`,
    sha256: "68b6bc4080ac1330234db2a9002d07f98b000537a1bd531a687b660d4160fa7f",
    archive: "tgz",
  },
  "darwin-x64": {
    url: `${RELEASES}/cloudflared-darwin-amd64.tgz`,
    sha256: "f11fbef4207d715892331917dafd437f032cf4b7137ed64dea3008338c1c613d",
    archive: "tgz",
  },
  "linux-arm64": {
    url: `${RELEASES}/cloudflared-linux-arm64`,
    sha256: "2b7203b4fb0ba28a0c1e12f8855ce2c25f76d266a8d5edafac5540b6812acff6",
    archive: "binary",
  },
  "linux-x64": {
    url: `${RELEASES}/cloudflared-linux-amd64`,
    sha256: "ae5e8add7884b0531d66bbca4570d1de491ff6da51e4ebe7eb160cdf241d9e42",
    archive: "binary",
  },
};

export type CloudflaredSource = "managed" | "override" | "path";

export interface ResolvedCloudflared {
  path: string;
  source: CloudflaredSource;
  /** True when this call fetched the pinned release. */
  downloaded: boolean;
}

export class CloudflaredInstallError extends Error {
  constructor(
    readonly reason:
      | "checksum"
      | "download"
      | "override_missing"
      | "unsupported"
      | "write",
    message: string,
  ) {
    super(message);
  }
}

export interface CloudflaredOptions {
  /** Defaults to `$ARGUS_HOME/bin/cloudflared`. */
  baseDir?: string;
  fetchImpl?: typeof fetch;
  assets?: Record<string, CloudflaredAsset>;
  platformKey?: string;
  env?: NodeJS.ProcessEnv;
}

function baseDirOf(opts: CloudflaredOptions): string {
  return opts.baseDir ?? join(argusHomeDir(), "bin", "cloudflared");
}

export function managedCloudflaredPath(opts: CloudflaredOptions = {}): string {
  return join(baseDirOf(opts), CLOUDFLARED_VERSION, "cloudflared");
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);

    return true;
  } catch {
    return false;
  }
}

async function onPath(env: NodeJS.ProcessEnv): Promise<string | null> {
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(dir, "cloudflared");
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

/** What would run right now, without downloading anything. */
export async function findCloudflared(
  opts: CloudflaredOptions = {},
): Promise<Omit<ResolvedCloudflared, "downloaded"> | null> {
  const env = opts.env ?? process.env;
  const override = env[OVERRIDE_ENV]?.trim();
  if (override) {
    return (await isExecutable(override))
      ? { path: override, source: "override" }
      : null;
  }
  const managed = managedCloudflaredPath(opts);
  if (await isExecutable(managed)) {
    return { path: managed, source: "managed" };
  }
  const path = await onPath(env);

  return path ? { path, source: "path" } : null;
}

/** Whether a pinned release exists for this machine. */
export function canInstallCloudflared(opts: CloudflaredOptions = {}): boolean {
  const assets = opts.assets ?? CLOUDFLARED_ASSETS;

  return Boolean(
    assets[opts.platformKey ?? `${process.platform}-${process.arch}`],
  );
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function download(
  asset: CloudflaredAsset,
  fetchImpl: typeof fetch,
): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetchImpl(asset.url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    throw new CloudflaredInstallError(
      "download",
      `Couldn't download cloudflared: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    throw new CloudflaredInstallError(
      "download",
      `Couldn't download cloudflared (HTTP ${res.status})`,
    );
  }

  return new Uint8Array(await res.arrayBuffer());
}

async function install(opts: CloudflaredOptions): Promise<string> {
  const assets = opts.assets ?? CLOUDFLARED_ASSETS;
  const key = opts.platformKey ?? `${process.platform}-${process.arch}`;
  const asset = assets[key];
  if (!asset) {
    throw new CloudflaredInstallError(
      "unsupported",
      `There's no cloudflared release for ${key}`,
    );
  }
  const bytes = await download(asset, opts.fetchImpl ?? fetch);
  if (sha256Hex(bytes) !== asset.sha256) {
    throw new CloudflaredInstallError(
      "checksum",
      "The downloaded cloudflared didn't match its checksum, so it wasn't installed",
    );
  }
  const finalPath = managedCloudflaredPath(opts);
  const versionDir = join(finalPath, "..");
  const staging = join(baseDirOf(opts), `.staging-${randomUUID()}`);
  try {
    await mkdir(staging, { recursive: true });
    let binary: string;
    if (asset.archive === "tgz") {
      const archive = join(staging, "cloudflared.tgz");
      await writeFile(archive, bytes);
      await execFileAsync("tar", ["-xzf", archive, "-C", staging]);
      binary = join(staging, "cloudflared");
    } else {
      binary = join(staging, "cloudflared");
      await writeFile(binary, bytes);
    }
    await chmod(binary, 0o755);
    await mkdir(versionDir, { recursive: true });
    await rename(binary, finalPath);
  } catch (err) {
    throw new CloudflaredInstallError(
      "write",
      `Couldn't install cloudflared: ${(err as Error).message}`,
    );
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
  await pruneOlder(opts);

  return finalPath;
}

/** Releases older than the pin are dead weight once the pin is installed. */
async function pruneOlder(opts: CloudflaredOptions): Promise<void> {
  const base = baseDirOf(opts);
  const entries = await readdir(base).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((name) => name !== CLOUDFLARED_VERSION && !name.startsWith("."))
      .map((name) =>
        rm(join(base, name), { recursive: true, force: true }).catch(
          () => undefined,
        ),
      ),
  );
}

let installing: Promise<string> | null = null;

/**
 * The binary to run, installing the pinned release when there's none. A
 * download that fails still falls back to a `cloudflared` on PATH.
 */
export async function ensureCloudflared(
  opts: CloudflaredOptions = {},
): Promise<ResolvedCloudflared> {
  const env = opts.env ?? process.env;
  const override = env[OVERRIDE_ENV]?.trim();
  if (override) {
    if (!(await isExecutable(override))) {
      throw new CloudflaredInstallError(
        "override_missing",
        `${OVERRIDE_ENV} points at ${override}, which isn't an executable`,
      );
    }

    return { path: override, source: "override", downloaded: false };
  }
  const managed = managedCloudflaredPath(opts);
  if (await isExecutable(managed)) {
    return { path: managed, source: "managed", downloaded: false };
  }
  installing ??= install(opts).finally(() => {
    installing = null;
  });
  try {
    return { path: await installing, source: "managed", downloaded: true };
  } catch (err) {
    const fallback = await onPath(env);
    if (fallback) {
      return { path: fallback, source: "path", downloaded: false };
    }
    throw err;
  }
}
