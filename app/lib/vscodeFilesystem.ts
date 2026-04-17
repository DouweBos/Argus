/**
 * VS Code workspace folder management + IPC filesystem provider.
 *
 * Registers a filesystem provider that bridges file:// URIs to the Electron
 * backend via IPC, then exposes updateWorkspaceFolder() to switch the VS Code
 * workspace to a real worktree directory.
 */

import { getService } from "@codingame/monaco-vscode-api";
import { ISearchService } from "@codingame/monaco-vscode-api/services";
import {
  Emitter,
  type Event,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import { Disposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { reinitializeWorkspace } from "@codingame/monaco-vscode-configuration-service-override";
import {
  FileSystemProviderCapabilities,
  FileSystemProviderError,
  FileSystemProviderErrorCode,
  FileType,
  type IFileChange,
  type IFileDeleteOptions,
  type IFileOverwriteOptions,
  type IFileSystemProviderWithFileReadWriteCapability,
  type IFileWriteOptions,
  type IStat,
  registerFileSystemOverlay,
} from "@codingame/monaco-vscode-files-service-override";

// ---------------------------------------------------------------------------
// Electron IPC helpers — thin wrappers that call the backend directly
// ---------------------------------------------------------------------------

function invoke<T>(
  channel: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return window.argus.invoke<T>(channel, args);
}

interface BackendDirEntry {
  is_dir: boolean;
  name: string;
  size: number;
}

interface BackendStat {
  is_dir: boolean;
  mtime: number;
  size: number;
}

async function backendStat(absPath: string): Promise<BackendStat> {
  return invoke<BackendStat>("stat_path", { path: absPath });
}

async function backendReadFile(absPath: string): Promise<string> {
  return invoke<string>("read_path", { path: absPath });
}

async function backendWriteFile(
  absPath: string,
  content: string,
): Promise<void> {
  await invoke("write_path", { path: absPath, content });
}

async function backendReaddir(absPath: string): Promise<BackendDirEntry[]> {
  return invoke<BackendDirEntry[]>("list_path", { path: absPath });
}

async function backendMkdir(absPath: string): Promise<void> {
  await invoke("mkdir_path", { path: absPath });
}

async function backendDelete(absPath: string): Promise<void> {
  await invoke("delete_path", { path: absPath });
}

async function backendRename(from: string, to: string): Promise<void> {
  await invoke("rename_path", { from, to });
}

// ---------------------------------------------------------------------------
// IPC-backed FileSystemProvider
// ---------------------------------------------------------------------------

class IpcFileSystemProvider
  extends Disposable
  implements IFileSystemProviderWithFileReadWriteCapability
{
  readonly capabilities =
    FileSystemProviderCapabilities.FileReadWrite |
    FileSystemProviderCapabilities.PathCaseSensitive;

  private readonly _onDidChangeCapabilities = this._register(
    new Emitter<void>(),
  );
  readonly onDidChangeCapabilities: Event<void> =
    this._onDidChangeCapabilities.event;

  private readonly _onDidChangeFile = this._register(
    new Emitter<readonly IFileChange[]>(),
  );
  readonly onDidChangeFile: Event<readonly IFileChange[]> =
    this._onDidChangeFile.event;

  watch() {
    // File watching is handled by Argus's existing chokidar watcher
    return { dispose() {} };
  }

  async stat(resource: URI): Promise<IStat> {
    try {
      const s = await backendStat(resource.fsPath);

      return {
        type: s.is_dir ? FileType.Directory : FileType.File,
        ctime: s.mtime,
        mtime: s.mtime,
        size: s.size,
      };
    } catch {
      throw FileSystemProviderError.create(
        `File not found: ${resource.fsPath}`,
        FileSystemProviderErrorCode.FileNotFound,
      );
    }
  }

  async readdir(resource: URI): Promise<[string, FileType][]> {
    const entries = await backendReaddir(resource.fsPath);

    return entries.map((e) => [
      e.name,
      e.is_dir ? FileType.Directory : FileType.File,
    ]);
  }

  async readFile(resource: URI): Promise<Uint8Array> {
    const text = await backendReadFile(resource.fsPath);

    return new TextEncoder().encode(text);
  }

  async writeFile(
    resource: URI,
    content: Uint8Array,
    _opts: IFileWriteOptions,
  ): Promise<void> {
    const text = new TextDecoder().decode(content);
    await backendWriteFile(resource.fsPath, text);
  }

  async mkdir(resource: URI): Promise<void> {
    await backendMkdir(resource.fsPath);
  }

  async delete(resource: URI, _opts: IFileDeleteOptions): Promise<void> {
    await backendDelete(resource.fsPath);
  }

  async rename(
    from: URI,
    to: URI,
    _opts: IFileOverwriteOptions,
  ): Promise<void> {
    await backendRename(from.fsPath, to.fsPath);
  }
}

// ---------------------------------------------------------------------------
// Registration — called once from vscodeSetup before services init
// ---------------------------------------------------------------------------

let registered = false;

/**
 * Register the IPC filesystem overlay so VS Code can read/write files
 * through the Electron backend. Must be called after initialize().
 */
export function registerIpcFilesystem(): void {
  if (registered) {
    return;
  }
  registered = true;
  // Priority > 0 puts our provider in front of the default in-memory one
  registerFileSystemOverlay(1, new IpcFileSystemProvider());
}

// ---------------------------------------------------------------------------
// Workspace switching
// ---------------------------------------------------------------------------

let currentPath: string | null = null;

/**
 * Switch the VS Code workspace to the given worktree directory path.
 * Called when the user selects a workspace in Argus's sidebar.
 */
export async function updateWorkspaceFolder(
  worktreePath: string,
): Promise<void> {
  if (worktreePath === currentPath) {
    return;
  }
  currentPath = worktreePath;

  await reinitializeWorkspace({
    id: worktreePath,
    uri: URI.file(worktreePath),
  });

  // The file search provider caches workspace folders at construction time and
  // never reacts to workspace changes. Reach in and re-index against the new
  // worktree so cmd+P and the search panel return results for the current
  // workspace.
  await refreshFileSearchIndex(worktreePath);
}

interface FileSearchProviderInternals {
  cachedFiles?: Set<URI>;
  initializeFileCache?: () => Promise<void>;
  initializeProvider?: () => Promise<void>;
  isInitialized?: boolean;
  workspaceFolders?: URI[];
}

/**
 * Force the monaco-vscode-api WorkspaceSearchProvider to re-index with the
 * current worktree as its single workspace folder. The provider is private
 * to the search service, so we reach into it by its shape.
 */
async function refreshFileSearchIndex(worktreePath: string): Promise<void> {
  try {
    const searchService = (await getService(ISearchService)) as unknown as {
      fileSearchProviders?: Map<string, FileSearchProviderInternals>;
    };

    const provider = searchService.fileSearchProviders?.get("file");
    if (!provider) {
      return;
    }

    const folderUri = URI.file(worktreePath);
    provider.workspaceFolders = [folderUri];
    provider.cachedFiles?.clear();
    if (provider.isInitialized) {
      await provider.initializeFileCache?.();
    } else {
      await provider.initializeProvider?.();
    }
  } catch {
    // Best-effort — search may remain unavailable until the service is ready.
  }
}

/**
 * Get the currently active worktree path, if any.
 */
export function getActiveWorktreePath(): string | null {
  return currentPath;
}
