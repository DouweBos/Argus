import type { TodoItem } from "../../../stores/conversationStore";
import { TodoList as PeacockTodoList } from "@argus/peacock";

interface TodoListProps {
  onDismiss?: () => void;
  todos: TodoItem[];
}

/** Desktop wrapper — the Peacock TodoList fed the store's TodoItem objects. */
export function TodoList({ todos, onDismiss }: TodoListProps) {
  return <PeacockTodoList onDismiss={onDismiss} todos={todos} />;
}
