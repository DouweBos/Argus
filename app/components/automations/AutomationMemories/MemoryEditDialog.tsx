import type {
  AutomationMemory,
  AutomationMemoryType,
} from "../../../lib/types";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  FormField,
  Input,
  SegmentedControl,
  TextArea,
} from "@argus/peacock";
import { saveAutomationMemory } from "../../../lib/ipc";
import styles from "./AutomationMemories.module.css";

const TITLE_ID = "memory-edit-title";

const TYPE_OPTIONS: { label: string; value: AutomationMemoryType }[] = [
  { label: "Project", value: "project" },
  { label: "Feedback", value: "feedback" },
  { label: "User", value: "user" },
  { label: "Reference", value: "reference" },
];

/** Create a memory, or edit one a run wrote. Saves straight to the host. */
export function MemoryEditDialog({
  automationId,
  memory,
  onClose,
}: {
  automationId: string;
  memory: AutomationMemory | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(memory?.name ?? "");
  const [type, setType] = useState<AutomationMemoryType>(
    memory?.type ?? "project",
  );
  const [description, setDescription] = useState(memory?.description ?? "");
  const [body, setBody] = useState(memory?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveAutomationMemory(automationId, {
        name: name.trim(),
        type,
        description,
        body,
        previous_name: memory?.name ?? null,
      });
      onClose();
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setSaving(false);
    }
  };

  const complete =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    body.trim().length > 0;

  return (
    <Dialog
      title={memory ? "Edit memory" : "Add memory"}
      titleId={TITLE_ID}
      size="medium"
      onClose={onClose}
    >
      <DialogBody>
        <FormField
          label="Name"
          helper="Lowercase kebab-case; also the file name."
        >
          <Input
            autoFocus={!memory}
            value={name}
            placeholder="session-merge-flow"
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
          label="Description"
          helper="One line, shown in the index every run reads."
        >
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>
        <FormField label="Memory" helper="Markdown.">
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
