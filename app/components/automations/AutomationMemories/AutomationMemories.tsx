import type { AutomationMemory } from "../../../lib/types";
import { useState } from "react";
import {
  Badge,
  Button,
  DestructiveConfirm,
  Disclosure,
  SectionPanel,
} from "@argus/peacock";
import { deleteAutomationMemory } from "../../../lib/ipc";
import { Markdown } from "../../shared/Markdown";
import styles from "./AutomationMemories.module.css";
import { MemoryEditDialog } from "./MemoryEditDialog";
import { useAutomationMemories } from "./useAutomationMemories";

function MemoryRow({
  automationId,
  memory,
  onEdit,
}: {
  automationId: string;
  memory: AutomationMemory;
  onEdit: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.name}>{memory.name}</span>
        <Badge size="tag" tone="neutral">
          {memory.type}
        </Badge>
        <span className={styles.spacer} />
        <Button size="sm" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
          Delete
        </Button>
      </div>
      <Disclosure summary={memory.description} toggleLabel="Memory">
        <Markdown className={styles.markdown} text={memory.body} />
      </Disclosure>
      <DestructiveConfirm
        open={confirming}
        title="Delete this memory?"
        description="Future runs won't see it. This cannot be undone."
        confirmLabel="Delete memory"
        cancelLabel="Keep it"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          deleteAutomationMemory(automationId, memory.name).catch(
            () => undefined,
          );
        }}
      />
    </div>
  );
}

/** What runs carried forward. Runs write these; the user curates them. */
export function AutomationMemories({ automationId }: { automationId: string }) {
  const { error, memories } = useAutomationMemories(automationId);
  // `null` is the add dialog; `undefined` is closed.
  const [editing, setEditing] = useState<AutomationMemory | null | undefined>(
    undefined,
  );

  return (
    <SectionPanel
      title="Memories"
      meta={memories ? `${memories.length}` : undefined}
      action={
        <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
          Add memory
        </Button>
      }
    >
      {error && <p className={styles.error}>{error}</p>}
      {memories?.length === 0 && (
        <p className={styles.empty}>
          Nothing yet. Runs save what they learn here so the next one does not
          start from scratch.
        </p>
      )}
      {memories && memories.length > 0 && (
        <div className={styles.list}>
          {memories.map((memory) => (
            <MemoryRow
              key={memory.name}
              automationId={automationId}
              memory={memory}
              onEdit={() => setEditing(memory)}
            />
          ))}
        </div>
      )}
      {editing !== undefined && (
        <MemoryEditDialog
          automationId={automationId}
          memory={editing}
          onClose={() => setEditing(undefined)}
        />
      )}
    </SectionPanel>
  );
}
