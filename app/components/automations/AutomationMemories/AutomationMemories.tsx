import { AutomationMemories as MemoriesPanel } from "@argus/peacock";
import { deleteAutomationMemory, saveAutomationMemory } from "../../../lib/ipc";
import { Markdown } from "../../shared/Markdown";
import { useAutomationMemories } from "./useAutomationMemories";

/** What runs carried forward, saved straight to the host. */
export function AutomationMemories({ automationId }: { automationId: string }) {
  const { error, memories } = useAutomationMemories(automationId);

  return (
    <MemoriesPanel
      error={error}
      memories={memories}
      renderMarkdown={(text, className) => (
        <Markdown className={className} text={text} />
      )}
      onDelete={(name) => {
        deleteAutomationMemory(automationId, name).catch(() => undefined);
      }}
      onSave={(memory) => saveAutomationMemory(automationId, memory)}
    />
  );
}
