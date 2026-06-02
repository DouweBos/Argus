/**
 * Loads VS Code / Cursor extensions from ~/.cursor/extensions/ and
 * ~/.vscode/extensions/ into the monaco-vscode-api runtime.
 *
 * Extensions are discovered by the Electron backend, then registered in the
 * renderer. Declarative contributions (themes, grammars, snippets, keybindings,
 * language configs, etc.) work immediately. Extensions with a `main` field
 * (Node.js) won't activate but their declarative parts still register.
 * Extensions with a `browser` field run as web workers.
 */

import {
  ExtensionHostKind,
  type IExtensionManifest,
  registerExtension,
} from "@codingame/monaco-vscode-api/extensions";
import { log, warn } from "@logger";

interface DiscoveredExtension {
  extensionPath: string;
  files: string[];
  manifest: Record<string, unknown>;
}

/**
 * Discover and register all local extensions. Call once after VS Code
 * services have initialized.
 */
export async function loadLocalExtensions(): Promise<void> {
  let extensions: DiscoveredExtension[];
  try {
    extensions = await window.argus.invoke<DiscoveredExtension[]>(
      "discover_extensions",
    );
  } catch (e) {
    warn("[extensions] Failed to discover local extensions:", e);

    return;
  }

  log(
    `[extensions] Found ${extensions.length} local extensions, registering...`,
  );

  for (const ext of extensions) {
    try {
      registerLocalExtension(ext);
    } catch (e) {
      const id = `${ext.manifest.publisher}.${ext.manifest.name}`;
      warn(`[extensions] Failed to register ${id}:`, e);
    }
  }
}

function registerLocalExtension(ext: DiscoveredExtension): void {
  const manifest = ext.manifest as unknown as IExtensionManifest;
  const hasBrowser = typeof manifest.browser === "string";

  // Choose the right host kind:
  // - browser field → LocalWebWorker (can actually run code)
  // - otherwise → LocalWebWorker (declarative contributions still register,
  //   Node.js activation just won't happen)
  const hostKind = hasBrowser
    ? ExtensionHostKind.LocalWebWorker
    : ExtensionHostKind.LocalWebWorker;

  // monaco-vscode-api builds the extension's location as
  // `URI.from({ scheme, authority: id, path })`. A URI that carries an
  // authority requires its path to begin with "/", so a raw Windows path
  // (C:\Users\...) throws "[UriError]: ...path...must begin with a slash".
  // Normalize separators and prefix a slash → /C:/Users/...; POSIX paths
  // (/Users/...) already satisfy this and pass through unchanged.
  const locationPath = toUriPath(ext.extensionPath);

  const result = registerExtension(manifest, hostKind, { path: locationPath });

  // Map every file in the extension to an argus-ext:// URL so VS Code can fetch
  // them (grammars, themes, icons, etc.). `file` is already forward-slashed and
  // relative; the URL reuses the normalized location path so the drive letter
  // sits after the leading slash (argus-ext://ext/C:/Users/.../file).
  for (const file of ext.files) {
    const url = `argus-ext://ext${locationPath}/${file}`;
    result.registerFileUrl(file, url);
  }
}

/**
 * Convert an absolute filesystem path into a URI path component. Backslashes
 * become forward slashes and a leading slash is added when missing (Windows
 * drive-letter paths) so the result is a valid path for a URI that has an
 * authority. POSIX paths already begin with "/" and are returned unchanged.
 */
function toUriPath(fsPath: string): string {
  const forward = fsPath.replace(/\\/g, "/");

  return forward.startsWith("/") ? forward : `/${forward}`;
}
