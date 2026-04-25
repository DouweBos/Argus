import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icons, Kbd, useDismissOnEscape } from "@argus/peacock";
import { useProjects } from "../../../hooks/useSessions";
import {
  closeOpenPalette,
  useOpenPaletteOpen,
} from "../../../stores/openPaletteStore";
import { useRecentProjects } from "../../../stores/recentProjectsStore";
import {
  selectSession,
  useSelectedSessionId,
  useSessions,
} from "../../../stores/sessionStore";
import styles from "./OpenPalette.module.css";

type OpenGroup = "open-project" | "recent-project" | "session";

interface OpenItem {
  group: OpenGroup;
  hint?: string[];
  icon: ReactNode;
  id: string;
  keywords: string;
  run: () => void;
  sublabel?: string;
  title: string;
}

const GROUP_LABELS: Record<OpenGroup, string> = {
  session: "Sessions",
  "open-project": "Open projects",
  "recent-project": "Recent projects",
};

const GROUP_ORDER: OpenGroup[] = ["session", "open-project", "recent-project"];

export function OpenPalette() {
  const open = useOpenPaletteOpen();
  if (!open) {
    return null;
  }

  return <OpenPaletteContent />;
}

function OpenPaletteContent() {
  const recent = useRecentProjects();
  const sessions = useSessions();
  const selectedId = useSelectedSessionId();
  const { openProject } = useProjects();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);
  useDismissOnEscape(closeOpenPalette);

  const items = useMemo<OpenItem[]>(() => {
    const out: OpenItem[] = [];

    sessions.forEach((w) => {
      const isCurrent = w.id === selectedId;
      out.push({
        group: "session",
        id: `session:${w.id}`,
        title: w.branch,
        sublabel: `${basename(w.repo_root)}${isCurrent ? " · current" : ""}`,
        icon: <Icons.ArgusLogo size={13} />,
        keywords: `${w.branch} ${w.repo_root} ${w.kind} session switch`,
        run: () => {
          closeOpenPalette();
          if (!isCurrent) {
            selectSession(w.id);
          }
        },
      });
    });

    const openRepoRoots = new Set(sessions.map((w) => w.repo_root));
    recent.forEach((p) => {
      const isOpen = openRepoRoots.has(p.path);
      out.push({
        group: isOpen ? "open-project" : "recent-project",
        id: `project:${p.path}`,
        title: p.name,
        sublabel: p.path,
        icon: <Icons.FolderIcon size={13} />,
        keywords: `${p.name} ${p.path} repo project open`,
        run: () => {
          closeOpenPalette();
          openProject(p.path).catch(() => {});
        },
      });
    });

    return out;
  }, [recent, sessions, selectedId, openProject]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return items;
    }

    return items.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        it.keywords.toLowerCase().includes(q) ||
        (it.sublabel?.toLowerCase().includes(q) ?? false),
    );
  }, [items, query]);

  const groups = useMemo(() => groupItems(filtered), [filtered]);
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const safeIndex = Math.min(Math.max(activeIndex, 0), ordered.length - 1);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [safeIndex]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      closeOpenPalette();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(Math.min(safeIndex + 1, ordered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(Math.max(safeIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = ordered[safeIndex];
      if (pick) {
        pick.run();
      }
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={onOverlayClick}
      role="presentation"
    >
      <div
        aria-label="Open project or session"
        aria-modal="true"
        className={styles.palette}
        role="dialog"
      >
        <div className={styles.searchRow}>
          <Icons.SearchIcon size={14} />
          <input
            ref={inputRef}
            aria-label="Search projects and sessions"
            autoComplete="off"
            autoFocus
            className={styles.input}
            placeholder="Search projects and sessions…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <Kbd keys={["esc"]} />
        </div>

        <div className={styles.results}>
          {filtered.length === 0 && (
            <div className={styles.empty}>No matches.</div>
          )}
          {groups.map((g) => (
            <div key={g.key} className={styles.group}>
              <div className={styles.groupHead}>{g.label}</div>
              {g.items.map((it) => {
                const globalIdx = ordered.indexOf(it);
                const active = globalIdx === safeIndex;

                return (
                  <button
                    key={it.id}
                    ref={active ? activeItemRef : undefined}
                    className={`${styles.item} ${active ? styles.itemActive : ""}`}
                    type="button"
                    onClick={() => it.run()}
                    onMouseEnter={() => setActiveIndex(globalIdx)}
                  >
                    <span className={styles.itemIcon}>{it.icon}</span>
                    <span className={styles.itemText}>
                      <span className={styles.itemTitle}>{it.title}</span>
                      {it.sublabel && (
                        <span className={styles.itemSub}>{it.sublabel}</span>
                      )}
                    </span>
                    {it.hint && <Kbd keys={it.hint} />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function groupItems(items: OpenItem[]) {
  return GROUP_ORDER.map((key) => ({
    key,
    label: GROUP_LABELS[key],
    items: items.filter((it) => it.group === key),
  })).filter((g) => g.items.length > 0);
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}
