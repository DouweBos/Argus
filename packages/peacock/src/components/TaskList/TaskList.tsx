import { useState } from "react";
import * as Icons from "../../icons/Icons";
import { Spinner } from "../Spinner/Spinner";
import styles from "./TaskList.module.css";

export interface TaskListItem {
  id: string;
  subject: string;
  status: "completed" | "in_progress" | "pending";
  activeForm?: string;
}

export interface TaskListProps {
  onDismiss?: () => void;
  tasks: TaskListItem[];
}

/** Collapsible progress panel for the stateful Task* tool family. */
export function TaskList({ tasks, onDismiss }: TaskListProps) {
  const completed = tasks.filter((t) => t.status === "completed").length;
  const inProgress = tasks.find((t) => t.status === "in_progress");
  const allDone = completed === tasks.length;
  const [open, setOpen] = useState(!allDone);

  const headerText = inProgress?.activeForm ?? inProgress?.subject ?? "Tasks";

  return (
    <div className={styles.section}>
      <span className={styles.label}>Tasks</span>
      <div className={styles.card}>
        <div
          className={`${styles.header} ${open ? styles.headerOpen : ""}`}
          onClick={() => setOpen((o) => !o)}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen((o) => !o);
            }
          }}
        >
          <div className={styles.headerLeft}>
            {!allDone && (
              <Spinner size="sm" tone="primary" aria-label="Working on tasks" />
            )}
            <span className={styles.progress}>{headerText}</span>
          </div>
          {onDismiss && (
            <button
              type="button"
              className={styles.dismiss}
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
              aria-label={allDone ? "Clear completed tasks" : "Clear tasks"}
            >
              <Icons.CloseIcon size={10} />
              Clear
            </button>
          )}
          <span className={styles.count}>
            {completed}/{tasks.length}
          </span>
          <span
            className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
          >
            <Icons.ChevronDownIcon size={12} />
          </span>
        </div>
        {open && (
          <div className={styles.list}>
            {tasks.map((task) => {
              let statusClass = styles.pending;
              if (task.status === "completed") {
                statusClass = styles.completed;
              } else if (task.status === "in_progress") {
                statusClass = styles.inProgress;
              }
              const label =
                task.status === "in_progress" && task.activeForm
                  ? task.activeForm
                  : task.subject;

              return (
                <div key={task.id} className={`${styles.item} ${statusClass}`}>
                  {task.status === "in_progress" ? (
                    <span className={styles.itemSpinner}>
                      <Spinner
                        size="sm"
                        tone="primary"
                        aria-label="In progress"
                      />
                    </span>
                  ) : (
                    <span className={styles.checkbox}>
                      {task.status === "completed" ? "✓" : ""}
                    </span>
                  )}
                  <span className={styles.text}>{label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
