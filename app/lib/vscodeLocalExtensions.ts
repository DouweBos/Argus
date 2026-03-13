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
  registerExtension,
  ExtensionHostKind,
  type IExtensionManifest,
} from "@codingame/monaco-vscode-api/extensions";

interface DiscoveredExtension {
  extensionPath: string;
  manifest: Record<string, unknown>;
  files: string[];
}

/**
 * Discover and register all local extensions. Call once after VS Code
 * services have initialized.
 */
export async function loadLocalExtensions(): Promise<void> {
  let extensions: DiscoveredExtension[];
  try {
    extensions = await window.stagehand.invoke<DiscoveredExtension[]>(
      "discover_extensions",
    );
  } catch (e) {
    console.warn("[extensions] Failed to discover local extensions:", e);
    return;
  }

  console.log(
    `[extensions] Found ${extensions.length} local extensions, registering...`,
  );

  for (const ext of extensions) {
    try {
      registerLocalExtension(ext);
    } catch (e) {
      const id = `${ext.manifest.publisher}.${ext.manifest.name}`;
      console.warn(`[extensions] Failed to register ${id}:`, e);
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

  const result = registerExtension(manifest, hostKind, {
    path: ext.extensionPath,
  });

  // Map every file in the extension to a stagehand-ext:// URL so VS Code
  // can fetch them (grammars, themes, icons, etc.)
  for (const file of ext.files) {
    const absolutePath = `${ext.extensionPath}/${file}`;
    const url = `stagehand-ext://ext${absolutePath}`;
    result.registerFileUrl(file, url);
  }
}
