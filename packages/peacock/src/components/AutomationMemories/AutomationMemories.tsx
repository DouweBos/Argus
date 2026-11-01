import type { RemoteAutomationMemory } from "@argus/remote-protocol";
import { type ReactNode, useState } from "react";
import { Badge } from "../Badge/Badge";
import { Button } from "../Button/Button";
import { DestructiveConfirm } from "../DestructiveConfirm/DestructiveConfirm";
import { Disclosure } from "../Disclosure/Disclosure";
import { Markdown } from "../Markdown/Markdown";
import { SectionPanel } from "../SectionPanel/SectionPanel";
import styles from "./AutomationMemories.module.css";
import { type MemoryDraft, MemoryEditDialog } from "./MemoryEditDialog";

export interface AutomationMemoriesProps {
  /** Null while loading. */
  memories: RemoteAutomationMemory[] | null;
  error?: string | null;
  /** Omit both to show the memories read-only. */
  onSave?: (memory: MemoryDraft) => Promise<unknown>;
  onDelete?: (name: string) => void;
  /** Desktop linkifies file paths; the default is Peacock's Markdown. */
  renderMarkdown?: (text: string, className: string) => ReactNode;
}

function MemoryRow({
  memory,
  onDelete,
  onEdit,
  render,
}: {
  memory: RemoteAutomationMemory;
  onDelete?: () => void;
  onEdit?: () => void;
  render: (text: string, className: string) => ReactNode;
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
        {onEdit && (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
        )}
        {onDelete && (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            Delete
          </Button>
        )}
      </div>
      <Disclosure summary={memory.description} toggleLabel="Memory">
        {render(memory.body, styles.markdown)}
      </Disclosure>
      {onDelete && (
        <DestructiveConfirm
          cancelLabel="Keep it"
          confirmLabel="Delete memory"
          description="Future runs won't see it. This cannot be undone."
          open={confirming}
          title="Delete this memory?"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onDelete();
          }}
        />
      )}
    </div>
  );
}

/** What runs carried forward. Runs write these; the user curates them. */
export function AutomationMemories({
  error,
  memories,
  onDelete,
  onSave,
  renderMarkdown,
}: AutomationMemoriesProps) {
  // `null` is the add dialog; `undefined` is closed.
  const [editing, setEditing] = useState<
    RemoteAutomationMemory | null | undefined
  >(undefined);
  const render =
    renderMarkdown ??
    ((text: string, className: string) => (
      <Markdown className={className} text={text} />
    ));

  return (
    <SectionPanel
      action={
        onSave && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setEditing(null)}
          >
            Add memory
          </Button>
        )
      }
      meta={memories ? `${memories.length}` : undefined}
      title="Memories"
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
              memory={memory}
              render={render}
              onDelete={onDelete && (() => onDelete(memory.name))}
              onEdit={onSave && (() => setEditing(memory))}
            />
          ))}
        </div>
      )}
      {editing !== undefined && onSave && (
        <MemoryEditDialog
          memory={editing}
          onClose={() => setEditing(undefined)}
          onSave={onSave}
        />
      )}
    </SectionPanel>
  );
}
