import { useState } from "react";
import { Icons } from "@argus/peacock";
import styles from "./TodoList.module.css";

export interface TodoItem {
  activeForm?: string;
  content: string;
  status: "completed" | "in_progress" | "pending";
}

interface TodoListProps {
  onDismiss?: () => void;
  todos: TodoItem[];
}

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
        <button
          type="button"
          className={`${styles.header} ${open ? styles.headerOpen : ""}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <div className={styles.headerLeft}>
            <span className={styles.progress}>{headerText}</span>
          </div>
          <span className={styles.count}>
            {completed}/{todos.length}
          </span>
          <span
            className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
          >
            <Icons.ChevronDownIcon size={12} />
          </span>
        </button>
        {allDone && onDismiss && (
          <button
            type="button"
            className={styles.dismiss}
            onClick={onDismiss}
            aria-label="Dismiss completed todos"
          >
            <Icons.CloseIcon size={10} />
            Clear completed list
          </button>
        )}
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
                  <span className={styles.checkbox}>
                    {todo.status === "completed" ? "\u2713" : ""}
                  </span>
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
