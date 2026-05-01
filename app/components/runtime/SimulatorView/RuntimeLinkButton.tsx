/**
 * Toolbar "Link" button — opens a dropdown of project-configured deep links
 * (`.argus.json#simulator_deeplinks`) and fires the chosen one into the
 * connected device via `conductor open-link`.
 *
 * Folder entries (`{ label, children }`) become nested submenus that
 * fly out on hover, so the popover stays compact regardless of how deep
 * the tree gets.
 */

import type { SimulatorDeeplinkConfig } from "../../../lib/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { ContextMenu, type ContextMenuItem, Icons } from "@argus/peacock";
import { error } from "@logger";
import { useArgusConfigVersion } from "../../../hooks/useArgusConfigVersion";
import { openDeviceDeepLink, readArgusConfig } from "../../../lib/ipc";
import { useSessions } from "../../../stores/sessionStore";
import chrome from "../RuntimeChrome.module.css";

interface RuntimeLinkButtonProps {
  /** Device identifier to target — UDID for iOS, serial for Android. */
  deviceKey: string;
  sessionId: string | null;
}

function isFolder(entry: SimulatorDeeplinkConfig): boolean {
  return Array.isArray(entry.children) && entry.children.length > 0;
}

function buildMenuItems(
  entries: SimulatorDeeplinkConfig[],
  deviceKey: string,
): ContextMenuItem[] {
  const out: ContextMenuItem[] = [];
  for (const entry of entries) {
    if (isFolder(entry)) {
      out.push({
        label: entry.label,
        icon: <Icons.FolderIcon size={12} />,
        children: buildMenuItems(entry.children ?? [], deviceKey),
      });
    } else if (entry.url) {
      out.push({
        label: entry.label,
        onClick: () => {
          openDeviceDeepLink(deviceKey, entry.url ?? "").catch((err) =>
            error("[Link] open-link failed:", err),
          );
        },
      });
    }
  }

  return out;
}

export function RuntimeLinkButton({
  deviceKey,
  sessionId,
}: RuntimeLinkButtonProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [links, setLinks] = useState<SimulatorDeeplinkConfig[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const sessions = useSessions();
  const repoRoot = useMemo(
    () =>
      sessionId
        ? (sessions.find((w) => w.id === sessionId)?.repo_root ?? null)
        : null,
    [sessionId, sessions],
  );
  const configVersion = useArgusConfigVersion(repoRoot);

  useEffect(() => {
    if (!repoRoot) {
      return;
    }
    let cancelled = false;
    readArgusConfig(repoRoot)
      .then((cfg) => {
        if (!cancelled) {
          setLinks(cfg.simulator_deeplinks ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLinks([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoRoot, configVersion]);

  const items = useMemo<ContextMenuItem[]>(() => {
    const built = buildMenuItems(links, deviceKey);
    if (built.length === 0) {
      return [
        {
          label: "No deep links configured",
          disabled: true,
        },
      ];
    }

    return built;
  }, [links, deviceKey]);

  const handleClick = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ x: rect.right, y: rect.bottom });
    }
    setOpen((v) => !v);
  };

  return (
    <>
      <button
        ref={triggerRef}
        className={chrome.titleBarButton}
        title="Open deep link"
        type="button"
        onClick={handleClick}
      >
        <Icons.LinkIcon size={12} />
      </button>
      {open && (
        <ContextMenu
          items={items}
          position={pos}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
