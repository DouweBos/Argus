import type { Task } from "../../../stores/conversationStore";
import { TaskList as PeacockTaskList } from "@argus/peacock";

interface TaskListProps {
  onDismiss?: () => void;
  tasks: Task[];
}

/** Desktop wrapper — the Peacock TaskList fed the store's Task objects. */
export function TaskList({ tasks, onDismiss }: TaskListProps) {
  return <PeacockTaskList onDismiss={onDismiss} tasks={tasks} />;
}
