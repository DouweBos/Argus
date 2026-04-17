import { useState } from "react";
import { ChevronDownIcon } from "../../shared/Icons";
import styles from "./TodoList.module.css";

export interface TodoItem {
  activeForm?: string;
  content: string;
  status: "completed" | "in_progress" | "pending";
}

interface TodoListProps {
  todos: TodoItem[];
}

export function TodoList({ todos }: TodoListProps) {
  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.find((t) => t.status === "in_progress");
  const allDone = completed === todos.length;
  const [open, setOpen] = useState(!allDone);

  const headerText = inProgress?.activeForm ?? inProgress?.content ?? "Todos";

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className={styles.headerLeft}>
          <span className={styles.label}>Todos</span>
          <span className={styles.progress}>
            {headerText} · {completed}/{todos.length}
          </span>
        </div>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}>
          <ChevronDownIcon size={12} />
        </span>
      </button>
      {open && (
        <div className={styles.list}>
          {todos.map((todo, i) => {
            const statusClass =
              todo.status === "completed"
                ? styles.completed
                : todo.status === "in_progress"
                  ? styles.inProgress
                  : styles.pending;
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
  );
}
