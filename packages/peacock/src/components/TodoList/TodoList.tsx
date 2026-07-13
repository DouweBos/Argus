import { useState } from "react";
import * as Icons from "../../icons/Icons";
import { Spinner } from "../Spinner/Spinner";
import styles from "./TodoList.module.css";

export interface TodoListItem {
  content: string;
  status: "completed" | "in_progress" | "pending";
  activeForm?: string;
}

export interface TodoListProps {
  onDismiss?: () => void;
  todos: TodoListItem[];
}

/** Collapsible progress panel for the agent's TodoWrite list. */
export function TodoList({ todos, onDismiss }: TodoListProps) {
  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.find((t) => t.status === "in_progress");
  const allDone = completed === todos.length;
  const [open, setOpen] = useState(!allDone);

  const headerText = inProgress?.activeForm ?? inProgress?.content ?? "Todos";

  return (
    <div className={styles.section}>
      <span className={styles.label}>Todos</span>
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
              <Spinner size="sm" tone="primary" aria-label="Working on todos" />
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
              aria-label={allDone ? "Clear completed todos" : "Clear todos"}
            >
              <Icons.CloseIcon size={10} />
              Clear
            </button>
          )}
          <span className={styles.count}>
            {completed}/{todos.length}
          </span>
          <span
            className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
          >
            <Icons.ChevronDownIcon size={12} />
          </span>
        </div>
        {open && (
          <div className={styles.list}>
            {todos.map((todo, i) => {
              let statusClass = styles.pending;
              if (todo.status === "completed") {
                statusClass = styles.completed;
              } else if (todo.status === "in_progress") {
                statusClass = styles.inProgress;
              }
              const label =
                todo.status === "in_progress" && todo.activeForm
                  ? todo.activeForm
                  : todo.content;

              return (
                <div key={i} className={`${styles.item} ${statusClass}`}>
                  {todo.status === "in_progress" ? (
                    <span className={styles.itemSpinner}>
                      <Spinner
                        size="sm"
                        tone="primary"
                        aria-label="In progress"
                      />
                    </span>
                  ) : (
                    <span className={styles.checkbox}>
                      {todo.status === "completed" ? "✓" : ""}
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
