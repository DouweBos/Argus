/**
 * Plugin asset resolver.
 *
 * Single read path for every plugin-owned binary, jar, or node tree. Today
 * it returns the existing bundled (`extraResources` / dev-tree) paths so the
 * resolver is in place without any behavior change. Chunk 11 layers a
 * downloaded-asset cache on top: `<userData>/plugins/<app-version>/<plugin>/`
 * is checked first, then the bundled fallback.
 *
 * After chunk 12 the bundled paths go away — `extraResources` no longer ships
 * the plugin assets, and the user toggles the plugin on (in onboarding or
 * Settings) to trigger the download.
 */

import type { PluginId } from "./types";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

/**
 * Static map of asset name → bundled path. We hand-author this rather than
 * deriving from the registry because the dev-tree layouts are heterogeneous
 * (`native/argus-sim-bridge/argus-sim-bridge`, `native/scrcpy-server/scrcpy-server.jar`,
 * `native/conductor/`) and the registry shouldn't carry that knowledge.
 */
interface AssetBundledLocator {
  /** Path relative to `process.resourcesPath` in packaged apps. */
  packaged: string;
  /** Path relative to `process.cwd()` in dev builds. */
  dev: string;
}

const BUNDLED: Record<PluginId, Record<string, AssetBundledLocator>> = {
  "device-recording": {
    "argus-sim-bridge": {
      packaged: "argus-sim-bridge",
      dev: path.join("native", "argus-sim-bridge", "argus-sim-bridge"),
    },
    "scrcpy-server.jar": {
      packaged: "scrcpy-server.jar",
      dev: path.join("native", "scrcpy-server", "scrcpy-server.jar"),
    },
  },
  "device-inspector": {},
  "device-control": {
    conductor: {
      packaged: "conductor",
      dev: path.join("native", "conductor"),
    },
  },
  "device-debug": {},
};

/** Per-app-version cache root for downloaded assets (chunk 11 onwards). */
function cacheRoot(): string {
  return path.join(app.getPath("userData"), "plugins", `v${app.getVersion()}`);
}

function cachedPath(pluginId: PluginId, assetName: string): string {
  return path.join(cacheRoot(), pluginId, assetName);
}

function bundledPath(pluginId: PluginId, assetName: string): string | null {
  const locator = BUNDLED[pluginId]?.[assetName];
  if (!locator) {
    return null;
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, locator.packaged);
  }

  return path.join(process.cwd(), locator.dev);
}

function exists(p: string): boolean {
  try {
    fs.accessSync(p);

    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the absolute path to a plugin asset.
 *
 * Returns the cached path if a downloaded copy exists for the running app
 * version, else the bundled path. Throws if neither resolves — at that point
 * the plugin is enabled but its assets have neither been downloaded nor
 * bundled, which (after chunk 12) means the user toggled the plugin on but
 * the download failed. Callers should surface a clear error.
 */
export function resolveAssetPath(
  pluginId: PluginId,
  assetName: string,
): string {
  const cached = cachedPath(pluginId, assetName);
  if (exists(cached)) {
    return cached;
  }
  // Fall back to the bundled candidate path even if it doesn't currently
  // exist on disk. After chunk 12 the bundled path is the dev-tree only —
  // packaged builds won't have it. Callers that need to verify availability
  // before exec'ing should call `isAssetAvailable` first; everyone else gets
  // the candidate and will fail at exec time with a clear ENOENT.
  const bundled = bundledPath(pluginId, assetName);
  if (bundled) {
    return bundled;
  }
  throw new Error(
    `Plugin asset not registered: ${pluginId}/${assetName} (no resolver entry)`,
  );
}

/** True if the asset is currently usable (cached or bundled) without download. */
export function isAssetAvailable(
  pluginId: PluginId,
  assetName: string,
): boolean {
  if (exists(cachedPath(pluginId, assetName))) {
    return true;
  }
  const bundled = bundledPath(pluginId, assetName);

  return Boolean(bundled && exists(bundled));
}

/**
 * Reverse-proxy URL pattern for GH release assets. The proxy fronts
 * `https://github.com/<org>/<repo>/releases/download/v<version>/...` to
 * keep the asset URL pinned to the running app version.
 */
const RELEASE_ASSET_BASE = "https://argus.houwert.dev/releases";

function platformSlug(): string {
  switch (process.platform) {
    case "darwin":
      return "darwin";
    case "win32":
      return "win32";
    case "linux":
      return "linux";
    default:
      return process.platform;
  }
}

function archSlug(): string {
  return process.arch;
}

interface AssetSpec {
  pluginId: PluginId;
  /** File or dir name as it appears under the cache dir. */
  name: string;
  /**
   * Asset class — drives whether we extract a tarball, mark executable, etc.
   * Mirrors `PluginAsset["kind"]` in the renderer types.
   */
  kind: "data" | "jar" | "native" | "node";
  /** When true, chmod +x the resolved file after download. */
  executable?: boolean;
}

/**
 * Static map of plugin id → assets to fetch when that plugin is enabled.
 * Hand-authored to mirror `app/plugins/registry.ts`. The release pipeline
 * (chunk 14) emits files matching the URL template below.
 */
const ASSETS_BY_PLUGIN: Record<PluginId, AssetSpec[]> = {
  "device-recording": [
    {
      pluginId: "device-recording",
      name: "argus-sim-bridge",
      kind: "native",
      executable: true,
    },
    {
      pluginId: "device-recording",
      name: "scrcpy-server.jar",
      kind: "jar",
    },
  ],
  "device-inspector": [],
  "device-control": [
    {
      pluginId: "device-control",
      name: "conductor",
      kind: "node",
    },
  ],
  "device-debug": [],
};

interface DownloadProgress {
  pluginId: PluginId;
  assetName: string;
  bytesDownloaded: number;
  bytesTotal: number | null;
}

export type DownloadProgressEmitter = (p: DownloadProgress) => void;

function assetUrl(spec: AssetSpec): string {
  const version = `v${app.getVersion()}`;
  // e.g. https://argus.houwert.dev/releases/v0.18.0/device-recording/argus-sim-bridge-arm64-darwin.zip
  // For node/jar/data the arch/platform suffix is ignored; the release script
  // emits a single platform-neutral artifact.
  if (spec.kind === "native") {
    return `${RELEASE_ASSET_BASE}/${version}/${spec.pluginId}/${spec.name}-${archSlug()}-${platformSlug()}.zip`;
  }

  return `${RELEASE_ASSET_BASE}/${version}/${spec.pluginId}/${spec.name}.zip`;
}

async function fetchToFile(
  url: string,
  destZip: string,
  emit: DownloadProgressEmitter,
  spec: AssetSpec,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${url} (${res.status})`);
  }
  const total = Number(res.headers.get("content-length") ?? "0") || null;
  await fs.promises.mkdir(path.dirname(destZip), { recursive: true });
  const out = fs.createWriteStream(destZip);
  let downloaded = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    downloaded += chunk.byteLength;
    out.write(chunk);
    emit({
      pluginId: spec.pluginId,
      assetName: spec.name,
      bytesDownloaded: downloaded,
      bytesTotal: total,
    });
  }
  await new Promise<void>((resolve, reject) => {
    out.end((err: NodeJS.ErrnoException | null | undefined) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function unzipTo(zipPath: string, destDir: string): Promise<void> {
  // macOS ditto preserves notarization staples on Mach-O extraction. On
  // other platforms we fall back to `unzip`, which loses them — but the
  // .zip is the artifact that's notarized, so single-file extraction
  // works on Linux/Windows where we don't have Gatekeeper anyway.
  const { execFile } = await import("node:child_process");
  await fs.promises.mkdir(destDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const cmd =
      process.platform === "darwin"
        ? ["ditto", "-x", "-k", zipPath, destDir]
        : ["unzip", "-q", "-o", zipPath, "-d", destDir];
    execFile(cmd[0], cmd.slice(1), (err) => (err ? reject(err) : resolve()));
  });
}

const inflight = new Map<PluginId, Promise<void>>();

/**
 * Download and stage every asset for the given plugin if not already cached.
 * Idempotent — concurrent calls share the same promise. After the call, the
 * resolver returns cached paths.
 */
export async function ensureAssetCached(
  pluginId: PluginId,
  emit?: DownloadProgressEmitter,
): Promise<void> {
  const existing = inflight.get(pluginId);
  if (existing) {
    return existing;
  }
  const promise = (async () => {
    const specs = ASSETS_BY_PLUGIN[pluginId];
    const noop: DownloadProgressEmitter = () => {};
    const onProgress = emit ?? noop;
    for (const spec of specs) {
      const finalPath = cachedPath(pluginId, spec.name);
      if (exists(finalPath)) {
        continue;
      }
      const stagingDir = path.join(cacheRoot(), pluginId, ".staging");
      await fs.promises.mkdir(stagingDir, { recursive: true });
      const zipPath = path.join(stagingDir, `${spec.name}.zip`);
      await fetchToFile(assetUrl(spec), zipPath, onProgress, spec);
      await unzipTo(zipPath, path.dirname(finalPath));
      await fs.promises.rm(zipPath, { force: true });
      if (spec.executable) {
        try {
          await fs.promises.chmod(finalPath, 0o755);
        } catch {
          // ignore — best-effort
        }
      }
    }
  })();
  inflight.set(pluginId, promise);
  try {
    await promise;
  } finally {
    inflight.delete(pluginId);
  }
}

/**
 * Drop cached assets for one plugin from the current-version dir. Used by
 * Settings → Plugins when the user toggles a plugin off (chunk 11).
 */
export async function clearAssetCache(pluginId: PluginId): Promise<void> {
  const dir = path.join(cacheRoot(), pluginId);
  await fs.promises.rm(dir, { recursive: true, force: true });
}

/**
 * Drop cached assets from prior app versions. Run once at startup so the
 * cache doesn't accumulate after several updates. Keeps the current version's
 * dir intact even if it's empty.
 */
export async function gcOldVersions(): Promise<void> {
  const root = path.dirname(cacheRoot());
  const current = path.basename(cacheRoot());
  let entries: string[];
  try {
    entries = await fs.promises.readdir(root);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((e) => e !== current && e.startsWith("v"))
      .map((e) =>
        fs.promises.rm(path.join(root, e), { recursive: true, force: true }),
      ),
  );
}
