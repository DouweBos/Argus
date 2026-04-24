import type { ProjectEntry } from "../../../lib/types";
import { useEffect, useRef } from "react";
import { useOutsideClick } from "../../../hooks/useOutsideClick";
import styles from "./ProjectPicker.module.css";

interface ProjectPickerProps {
  /** Optional empty-state message when no other projects are available. */
  emptyText?: string;
  /** Paths of projects that should not appear in the list (e.g. current session). */
  excludePaths?: string[];
  onClose: () => void;
  onToggle: (projectPath: string) => void;
  projects: ProjectEntry[];
  /** Paths currently linked to the chat. */
  selectedPaths: string[];
}

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);

  return parts[parts.length - 1] ?? p;
}

export function ProjectPicker({
  projects,
  selectedPaths,
  excludePaths,
  emptyText,
  onToggle,
  onClose,
}: ProjectPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useOutsideClick(ref, true, onClose);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleEscape);

    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const exclude = new Set(excludePaths ?? []);
  const visible = projects.filter((p) => !exclude.has(p.path));

  return (
    <div ref={ref} className={styles.picker}>
      <div className={styles.header}>Link project</div>
      <div className={styles.hint}>
        Linked projects are shared with the agent so it can read from and edit
        their files, alongside its own worktree.
      </div>
      {visible.length === 0 ? (
        <div className={styles.empty}>
          {emptyText ??
            "No other projects available. Add one from the Argus home screen or declare it under related_projects in .argus.json."}
        </div>
      ) : (
        visible.map((project) => {
          const isActive = selectedPaths.includes(project.path);

          return (
            <button
              key={project.path}
              className={`${styles.option} ${isActive ? styles.optionActive : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onToggle(project.path);
              }}
            >
              <div className={styles.checkbox} aria-hidden="true">
                {isActive && <span className={styles.checkboxCheck}>✓</span>}
              </div>
              <div className={styles.optionLabel}>
                <span className={styles.optionName}>
                  {basename(project.path)}
                </span>
                <span className={styles.optionPath}>{project.path}</span>
                {project.description && (
                  <span className={styles.optionDesc}>
                    {project.description}
                  </span>
                )}
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}
