import { describeError } from "@argus/client-core";
import type { RemoteAutomationMemory } from "@argus/remote-protocol";
import { useState } from "react";
import { Button } from "../Button/Button";
import { Dialog } from "../Dialog/Dialog";
import { DialogBody } from "../Dialog/DialogBody";
import { DialogFooter } from "../Dialog/DialogFooter";
import { FormField } from "../FormField/FormField";
import { Input, TextArea } from "../Input/Input";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import styles from "./AutomationMemories.module.css";

const TITLE_ID = "memory-edit-title";

type MemoryType = RemoteAutomationMemory["type"];

const TYPE_OPTIONS: { label: string; value: MemoryType }[] = [
  { label: "Project", value: "project" },
  { label: "Feedback", value: "feedback" },
  { label: "User", value: "user" },
  { label: "Reference", value: "reference" },
];

/** What a save sends: the memory, and the name it had when it was opened. */
export interface MemoryDraft {
  name: string;
  type: MemoryType;
  description: string;
  body: string;
  /** Set when editing, so a changed name renames rather than copies. */
  previous_name: string | null;
}

export interface MemoryEditDialogProps {
  /** Null adds one. */
  memory: RemoteAutomationMemory | null;
  onClose: () => void;
  onSave: (memory: MemoryDraft) => Promise<unknown>;
}

/** Create a memory, or edit one a run wrote. */
export function MemoryEditDialog({
  memory,
  onClose,
  onSave,
}: MemoryEditDialogProps) {
  const [name, setName] = useState(memory?.name ?? "");
  const [type, setType] = useState<MemoryType>(memory?.type ?? "project");
  const [description, setDescription] = useState(memory?.description ?? "");
  const [body, setBody] = useState(memory?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        type,
        description,
        body,
        previous_name: memory?.name ?? null,
      });
      onClose();
    } catch (e) {
      setError(describeError(e));
      setSaving(false);
    }
  };

  const complete =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    body.trim().length > 0;

  return (
    <Dialog
      size="medium"
      title={memory ? "Edit memory" : "Add memory"}
      titleId={TITLE_ID}
      onClose={onClose}
    >
      <DialogBody>
        <FormField
          helper="Lowercase kebab-case; also the file name."
          label="Name"
        >
          <Input
            autoFocus={!memory}
            placeholder="session-merge-flow"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <FormField label="Type">
          <SegmentedControl
            options={TYPE_OPTIONS}
            value={type}
            onChange={setType}
          />
        </FormField>
        <FormField
          helper="One line, shown in the index every run reads."
          label="Description"
        >
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>
        <FormField helper="Markdown." label="Memory">
          <TextArea
            mono
            className={styles.body}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </FormField>
        {error && <p className={styles.error}>{error}</p>}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!complete || saving}
          onClick={() => {
            save().catch(() => undefined);
          }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
