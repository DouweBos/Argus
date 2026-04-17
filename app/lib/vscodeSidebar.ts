/**
 * Sidebar view switching helpers — wraps VS Code's IPaneCompositePartService.
 */
import { getService } from "@codingame/monaco-vscode-api";
import { IPaneCompositePartService } from "@codingame/monaco-vscode-api/services";
import { viewContainerRegistry } from "@codingame/monaco-vscode-views-service-override";

// ViewContainerLocation.Sidebar = 0 (const enum, inlined at compile time)
const SIDEBAR_LOCATION = 0;

export type SidebarViewIcon =
  | { name: string; type: "codicon" }
  | { src: string; type: "url" };

export interface SidebarViewInfo {
  icon?: SidebarViewIcon;
  id: string;
  name: string;
}

let servicePromise: Promise<IPaneCompositePartService> | null = null;

function getPaneService() {
  if (!servicePromise) {
    servicePromise = getService(IPaneCompositePartService);
  }

  return servicePromise;
}

/**
 * Convert a URI to a loadable URL. Extension URIs use schemes like
 * `extension-file://` that Electron doesn't natively serve. Rewrite
 * them to the registered `argus-ext://` protocol which resolves
 * to the local filesystem.
 */
function toLoadableUrl(uri: {
  path?: string;
  scheme?: string;
  toString: () => string;
}): string {
  if (uri.scheme === "extension-file" && uri.path) {
    return `argus-ext://ext${uri.path}`;
  }

  return uri.toString();
}

/** Build icon info from a view container's icon property */
function resolveIcon(icon: unknown | undefined): SidebarViewIcon | undefined {
  if (!icon || typeof icon !== "object") {
    return undefined;
  }

  // ThemeIcon — has an `id` string property (codicon name)
  if ("id" in icon && typeof (icon as { id: unknown }).id === "string") {
    return { type: "codicon", name: (icon as { id: string }).id };
  }

  // URI — has `scheme` and `path` or `toString()`
  if ("scheme" in icon) {
    const uri = icon as {
      path?: string;
      scheme?: string;
      toString: () => string;
    };

    return { type: "url", src: toLoadableUrl(uri) };
  }

  return undefined;
}

export async function openSidebarView(viewId: string): Promise<void> {
  const svc = await getPaneService();
  await svc.openPaneComposite(viewId, SIDEBAR_LOCATION, true);
}

export async function getSidebarViews(): Promise<SidebarViewInfo[]> {
  const svc = await getPaneService();

  // Build a map from view container ID → icon using the registry
  const iconMap = new Map<string, SidebarViewIcon>();
  for (const vc of viewContainerRegistry.all) {
    const resolved = resolveIcon((vc as unknown as { icon?: unknown }).icon);
    if (resolved) {
      iconMap.set(vc.id, resolved);
    }
  }

  return svc.getPaneComposites(SIDEBAR_LOCATION).map((d) => ({
    id: d.id,
    name: (d as unknown as { name?: string }).name ?? d.id,
    icon: iconMap.get(d.id),
  }));
}

export async function getActiveSidebarViewId(): Promise<string | undefined> {
  const svc = await getPaneService();

  return svc.getActivePaneComposite(SIDEBAR_LOCATION)?.getId();
}

export function onSidebarViewChange(callback: (viewId: string) => void): {
  dispose: () => void;
} {
  let disposed = false;
  let inner: { dispose: () => void } | null = null;

  getPaneService().then((svc) => {
    if (disposed) {
      return;
    }
    inner = svc.onDidPaneCompositeOpen(
      ({ composite, viewContainerLocation }) => {
        if (viewContainerLocation === SIDEBAR_LOCATION) {
          callback(composite.getId());
        }
      },
    );
  });

  return {
    dispose() {
      disposed = true;
      inner?.dispose();
    },
  };
}
