import { useEffect, useRef, useState } from "react";
import {
  type SidebarViewIcon,
  type SidebarViewInfo,
  getActiveSidebarViewId,
  getSidebarViews,
  onSidebarViewChange,
  openSidebarView,
} from "../../../lib/vscodeSidebar";
import styles from "./SidebarHeader.module.css";

/** Keyboard shortcuts for well-known views */
const VIEW_SHORTCUTS: Record<string, string> = {
  "workbench.view.explorer": "⇧⌘E",
  "workbench.view.search": "⇧⌘F",
  "workbench.view.extensions": "⇧⌘X",
  "workbench.view.scm": "⌃⇧G",
  "workbench.view.debug": "⇧⌘D",
};

const DEFAULT_PINNED = [
  "workbench.view.explorer",
  "workbench.view.search",
  "workbench.view.extensions",
];

const STORAGE_KEY = "argus.sidebar.pinned";

function loadPinned(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // ignore
  }

  return DEFAULT_PINNED;
}

/** Render a view icon — codicon span or extension image */
function ViewIcon({
  icon,
  size = 16,
}: {
  icon?: SidebarViewIcon;
  size?: number;
}) {
  if (!icon) {
    return (
      <span
        className="codicon codicon-window"
        style={{ flexShrink: 0, width: size + 4, textAlign: "center" }}
      />
    );
  }

  if (icon.type === "codicon") {
    return (
      <span
        className={`codicon codicon-${icon.name}`}
        style={{ flexShrink: 0, width: size + 4, textAlign: "center" }}
      />
    );
  }

  return (
    <img
      alt=""
      className={styles.extensionIcon}
      src={icon.src}
      style={{ width: size, height: size }}
    />
  );
}

export function SidebarHeader() {
  const [activeViewId, setActiveViewId] = useState("workbench.view.explorer");
  const [pinnedIds, setPinnedIds] = useState(loadPinned);
  const [allViews, setAllViews] = useState<SidebarViewInfo[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load views and track active view
  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const views = await getSidebarViews();
        if (!disposed) {
          setAllViews(views);
        }

        const active = await getActiveSidebarViewId();
        if (!disposed && active) {
          setActiveViewId(active);
        }
      } catch {
        // Services not ready yet
      }
    })();

    const sub = onSidebarViewChange((id) => {
      if (!disposed) {
        setActiveViewId(id);
      }
    });

    return () => {
      disposed = true;
      sub.dispose();
    };
  }, []);

  // Persist pinned state
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pinnedIds));
  }, [pinnedIds]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) {
      return;
    }
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handler);

    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  // Refresh views when dropdown opens (picks up late-loaded extensions)
  useEffect(() => {
    if (!dropdownOpen) {
      return;
    }
    getSidebarViews()
      .then(setAllViews)
      .catch(() => {});
  }, [dropdownOpen]);

  const handleViewClick = (viewId: string) => {
    openSidebarView(viewId);
    setDropdownOpen(false);
  };

  const togglePin = (viewId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPinnedIds((prev) =>
      prev.includes(viewId)
        ? prev.filter((id) => id !== viewId)
        : [...prev, viewId],
    );
  };

  // Build a lookup for view info
  const viewMap = new Map(allViews.map((v) => [v.id, v]));

  // Only show pinned icons that exist in the available views
  const visiblePinned = pinnedIds.filter(
    (id) => viewMap.size === 0 || viewMap.has(id),
  );

  return (
    <div ref={containerRef} className={styles.header}>
      <div className={styles.iconRow}>
        {visiblePinned.map((id) => (
          <button
            key={id}
            className={`${styles.iconBtn} ${id === activeViewId ? styles.active : ""}`}
            title={viewMap.get(id)?.name ?? id}
            onClick={() => handleViewClick(id)}
          >
            <ViewIcon icon={viewMap.get(id)?.icon} />
          </button>
        ))}
        <button
          className={`${styles.iconBtn} ${styles.chevronBtn}`}
          title="Views"
          onClick={() => setDropdownOpen(!dropdownOpen)}
        >
          <span
            className={`codicon codicon-chevron-${dropdownOpen ? "up" : "down"}`}
          />
        </button>
      </div>

      {dropdownOpen && (
        <div className={styles.dropdown}>
          {allViews.map((view) => (
            <div
              key={view.id}
              className={`${styles.item} ${view.id === activeViewId ? styles.active : ""}`}
              onClick={() => handleViewClick(view.id)}
            >
              <ViewIcon icon={view.icon} />
              <span className={styles.itemLabel}>
                {view.name}
                {VIEW_SHORTCUTS[view.id] && (
                  <span className={styles.itemShortcut}>
                    {VIEW_SHORTCUTS[view.id]}
                  </span>
                )}
              </span>
              <button
                className={`${styles.pinBtn} ${pinnedIds.includes(view.id) ? styles.pinned : ""}`}
                title={
                  pinnedIds.includes(view.id) ? "Unpin from top" : "Pin to top"
                }
                onClick={(e) => togglePin(view.id, e)}
              >
                <span className="codicon codicon-pinned" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
