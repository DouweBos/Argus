import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@argus/peacock";
import { setConversationTitle } from "../../../stores/conversationStore";
import { Dialog, dialogStyles as styles } from "../../shared/Dialog";

interface RenameAgentDialogProps {
  agentId: string;
  currentTitle: string;
  onClose: () => void;
}

export function RenameAgentDialog({
  agentId,
  currentTitle,
  onClose,
}: RenameAgentDialogProps) {
  const [value, setValue] = useState(currentTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = value.trim();
    if (next) {
      setConversationTitle(agentId, next);
    }
    onClose();
  };

  return (
    <Dialog title="Rename Agent" titleId="rename-agent-title" onClose={onClose}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="rename-agent-input">
            Title
          </label>
          <Input
            id="rename-agent-input"
            ref={inputRef}
            value={value}
            placeholder="Enter a title"
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </div>
        <div className={styles.footer}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!value.trim()}>
            Rename
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
