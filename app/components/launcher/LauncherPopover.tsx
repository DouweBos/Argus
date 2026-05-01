import type { ProjectEntry, Session } from "../../lib/types";
import type { ReactNode, RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icons } from "@argus/peacock";
import { useOutsideClick } from "../../hooks/useOutsideClick";
import { showOpenDirectoryDialog } from "../../lib/ipc";
import styles from "./LauncherPopover.module.css";

type SessionMode =
  | { kind: "existing"; sessionId: string }
  | { kind: "new" }
  | { kind: "root" };

interface PickerRect {
  bottom: number;
  left: number;
}

interface ShellProps {
  children: ReactNode;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
}

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);

  return parts[parts.length - 1] ?? p;
}

function PopoverShell({ triggerRef, onClose, children }: ShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<PickerRect | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const node = triggerRef.current;
      if (!node) {
        return;
      }
      const r = node.getBoundingClientRect();
      setRect({ left: r.left, bottom: window.innerHeight - r.top + 6 });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [triggerRef]);

  useOutsideClick(
    ref,
    true,
    onClose,
    (target) => triggerRef.current?.contains(target) ?? false,
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!rect) {
    return null;
  }

  return createPortal(
    <div
      ref={ref}
      className={styles.popover}
      style={{ left: rect.left, bottom: rect.bottom }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Project picker (single-select)
// ---------------------------------------------------------------------------

export function LauncherProjectPopover({
  triggerRef,
  projects,
  selectedPath,
  onSelect,
  onClose,
}: {
  onClose: () => void;
  onSelect: (project: ProjectEntry) => void;
  projects: ProjectEntry[];
  selectedPath: string | null;
  triggerRef: RefObject<HTMLElement | null>;
}) {
  return (
    <PopoverShell triggerRef={triggerRef} onClose={onClose}>
      <div className={styles.header}>Project</div>
      {projects.length === 0 ? (
        <div className={styles.empty}>
          No projects registered. Add one from the Argus home screen.
        </div>
      ) : (
        projects.map((project) => {
          const active = project.path === selectedPath;

          return (
            <button
              key={project.path}
              type="button"
              className={`${styles.option} ${active ? styles.optionActive : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(project);
              }}
            >
              <span className={styles.optionName}>
                {basename(project.path)}
              </span>
              <span className={styles.optionPath}>{project.path}</span>
            </button>
          );
        })
      )}
    </PopoverShell>
  );
}

// ---------------------------------------------------------------------------
// Session picker
// ---------------------------------------------------------------------------

function isSelected(mode: SessionMode, candidate: SessionMode): boolean {
  if (mode.kind !== candidate.kind) {
    return false;
  }
  if (mode.kind === "existing" && candidate.kind === "existing") {
    return mode.sessionId === candidate.sessionId;
  }

  return true;
}

export function LauncherSessionPopover({
  triggerRef,
  sessions,
  mode,
  onSelect,
  onClose,
}: {
  mode: SessionMode;
  onClose: () => void;
  onSelect: (mode: SessionMode) => void;
  sessions: Session[];
  triggerRef: RefObject<HTMLElement | null>;
}) {
  const worktree = sessions.filter((s) => s.kind === "worktree");

  return (
    <PopoverShell triggerRef={triggerRef} onClose={onClose}>
      <div className={styles.header}>Where should the agent run?</div>
      <button
        type="button"
        className={`${styles.option} ${
          isSelected(mode, { kind: "root" }) ? styles.optionActive : ""
        }`}
        onMouseDown={(e) => {
          e.preventDefault();
          onSelect({ kind: "root" });
        }}
      >
        <span className={styles.optionName}>Project root</span>
        <span className={styles.optionPath}>
          Run on whatever branch is checked out in the project directory
        </span>
      </button>
      <button
        type="button"
        className={`${styles.option} ${
          isSelected(mode, { kind: "new" }) ? styles.optionActive : ""
        }`}
        onMouseDown={(e) => {
          e.preventDefault();
          onSelect({ kind: "new" });
        }}
      >
        <span className={styles.optionName}>New session</span>
        <span className={styles.optionPath}>
          Branch off a new worktree — name will be generated from the prompt
        </span>
      </button>
      {worktree.length > 0 && (
        <div className={styles.sectionHeader}>Existing sessions</div>
      )}
      {worktree.map((s) => {
        const candidate: SessionMode = { kind: "existing", sessionId: s.id };
        const active = isSelected(mode, candidate);
        const label = s.display_name ?? s.branch;

        return (
          <button
            key={s.id}
            type="button"
            className={`${styles.option} ${active ? styles.optionActive : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(candidate);
            }}
          >
            <span className={styles.optionName}>{label}</span>
            {s.display_name && s.branch !== s.display_name && (
              <span className={styles.optionPath}>{s.branch}</span>
            )}
          </button>
        );
      })}
    </PopoverShell>
  );
}

// ---------------------------------------------------------------------------
// Linked-projects picker (multi-select)
// ---------------------------------------------------------------------------

export function LauncherLinkedPopover({
  triggerRef,
  projects,
  selectedPaths,
  excludePaths,
  onToggle,
  onClose,
}: {
  excludePaths?: string[];
  onClose: () => void;
  onToggle: (path: string) => void;
  projects: ProjectEntry[];
  selectedPaths: string[];
  triggerRef: RefObject<HTMLElement | null>;
}) {
  const exclude = new Set(excludePaths ?? []);
  const visible = projects.filter((p) => !exclude.has(p.path));

  const handleBrowse = async () => {
    try {
      const selected = await showOpenDirectoryDialog("Link directory");
      if (selected && !selectedPaths.includes(selected)) {
        onToggle(selected);
      }
    } catch {
      // dialog cancelled
    }
  };

  return (
    <PopoverShell triggerRef={triggerRef} onClose={onClose}>
      <div className={styles.header}>Link other projects</div>
      <button
        type="button"
        className={styles.browse}
        onMouseDown={(e) => {
          e.preventDefault();
          handleBrowse().catch(() => undefined);
        }}
      >
        <Icons.FolderIcon size={13} />
        <span>Browse for directory…</span>
      </button>
      {visible.length === 0 ? (
        <div className={styles.empty}>
          No other projects available. Use Browse to link any directory.
        </div>
      ) : (
        visible.map((project) => {
          const active = selectedPaths.includes(project.path);

          return (
            <button
              key={project.path}
              type="button"
              className={`${styles.option} ${active ? styles.optionActive : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onToggle(project.path);
              }}
            >
              <span
                className={`${styles.checkbox} ${active ? styles.checkboxActive : ""}`}
                aria-hidden="true"
              >
                {active && <Icons.CheckIcon size={10} />}
              </span>
              <span className={styles.optionName}>
                {basename(project.path)}
              </span>
              <span className={styles.optionPath}>{project.path}</span>
            </button>
          );
        })
      )}
    </PopoverShell>
  );
}
