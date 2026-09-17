import type { DragEvent, MouseEvent, ReactNode } from "react";
import { useCallback, useState } from "react";
import { CloseIcon, LaptopIcon, PlusIcon } from "../../icons/Icons";
import { HostBadge } from "../HostBadge/HostBadge";
import styles from "./WindowTabStrip.module.css";

/** How the machine behind a tab is doing. */
export type WindowTabState = "connected" | "disconnected" | "reconnecting";

export type WindowTabDropSide = "after" | "before";

export interface WindowTabItem {
  active?: boolean;
  /** Machine this tab reads from, e.g. "Mac mini". */
  hostLabel: string;
  id: string;
  /** This Mac — shown with a laptop mark instead of a host badge. */
  local?: boolean;
  /** Pinned tabs cannot be closed or dragged. */
  pinned?: boolean;
  state?: WindowTabState;
  /** Second line of the tooltip — usually the project or screen. */
  subtitle?: string;
  title: string;
}

export interface WindowTabStripProps {
  /** Rendered at the right end of the strip (status, pickers). */
  actions?: ReactNode;
  newTabTitle?: string;
  onClose: (id: string) => void;
  onNew?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Omit to disable drag reordering. */
  onReorder?: (
    fromId: string,
    targetId: string,
    side: WindowTabDropSide,
  ) => void;
  onSelect: (id: string) => void;
  tabs: WindowTabItem[];
}

const BADGE_STATE = {
  connected: "connected",
  disconnected: "offline",
  reconnecting: "reconnecting",
} as const;

/**
 * Browser-style window tabs. Each tab is one saved screen on one machine, so a
 * remote session and a local one sit side by side and switching between them
 * puts back exactly what was there.
 */
export function WindowTabStrip({
  tabs,
  onSelect,
  onClose,
  onNew,
  onReorder,
  actions,
  newTabTitle = "New tab",
}: WindowTabStripProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{
    id: string;
    side: WindowTabDropSide;
  } | null>(null);

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, id: string) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
      setDraggingId(id);
    },
    [],
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>, id: string) => {
      if (!draggingId || draggingId === id || !onReorder) {
        return;
      }
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const side: WindowTabDropSide =
        event.clientX < rect.left + rect.width / 2 ? "before" : "after";
      setDrop((prev) =>
        prev && prev.id === id && prev.side === side ? prev : { id, side },
      );
    },
    [draggingId, onReorder],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, targetId: string) => {
      event.preventDefault();
      const fromId = event.dataTransfer.getData("text/plain") || draggingId;
      const side = drop?.side ?? "before";
      setDraggingId(null);
      setDrop(null);
      if (fromId && fromId !== targetId) {
        onReorder?.(fromId, targetId, side);
      }
    },
    [draggingId, drop, onReorder],
  );

  const endDrag = useCallback(() => {
    setDraggingId(null);
    setDrop(null);
  }, []);

  const soleLocalTab = tabs.length === 1 && Boolean(tabs[0]?.local);

  return (
    <div className={styles.strip} role="tablist">
      <div className={styles.tabs}>
        {tabs.map((tab) => {
          const state = tab.state ?? "connected";
          const closable = !tab.pinned;
          const indicator = drop?.id === tab.id ? drop.side : null;

          return (
            <div
              key={tab.id}
              aria-selected={tab.active ?? false}
              className={[
                styles.tab,
                tab.active ? styles.active : "",
                state === "disconnected" ? styles.disconnected : "",
                draggingId === tab.id ? styles.dragging : "",
                indicator === "before" ? styles.dropBefore : "",
                indicator === "after" ? styles.dropAfter : "",
              ]
                .filter(Boolean)
                .join(" ")}
              draggable={Boolean(onReorder) && !tab.pinned}
              role="tab"
              tabIndex={tab.active ? 0 : -1}
              title={
                tab.subtitle ? `${tab.title} — ${tab.subtitle}` : tab.title
              }
              onClick={() => onSelect(tab.id)}
              onDragEnd={endDrag}
              onDragOver={(event) => handleDragOver(event, tab.id)}
              onDragStart={(event) => handleDragStart(event, tab.id)}
              onDrop={(event) => handleDrop(event, tab.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(tab.id);
                }
              }}
              onMouseDown={(event) => {
                // Middle click closes, as in a browser.
                if (event.button === 1 && closable) {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
            >
              {tab.local ? (
                // A lone local tab is just "the window" — naming the machine
                // there is noise. A remote tab always says so, however few.
                !soleLocalTab && (
                  <span className={styles.localMark} title={tab.hostLabel}>
                    <LaptopIcon size={11} />
                    <span className={styles.localLabel}>{tab.hostLabel}</span>
                  </span>
                )
              ) : (
                <HostBadge
                  className={styles.host}
                  label={tab.hostLabel}
                  state={BADGE_STATE[state]}
                />
              )}
              <span className={styles.title}>{tab.title}</span>
              {closable && (
                <button
                  aria-label={`Close ${tab.title}`}
                  className={styles.close}
                  title="Close tab"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.id);
                  }}
                >
                  <CloseIcon size={10} />
                </button>
              )}
            </div>
          );
        })}
        {onNew && (
          <button
            aria-label={newTabTitle}
            className={styles.new}
            title={newTabTitle}
            type="button"
            onClick={onNew}
          >
            <PlusIcon size={11} />
          </button>
        )}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
