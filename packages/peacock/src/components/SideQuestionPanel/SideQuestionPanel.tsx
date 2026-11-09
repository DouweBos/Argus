import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../Button/Button";
import { Input } from "../Input/Input";
import { Spinner } from "../Spinner/Spinner";
import styles from "./SideQuestionPanel.module.css";

export interface SideQuestionItem {
  id: string;
  question: string;
  answer?: string;
  error?: string;
  pending: boolean;
  /** Already sent on into the agent's chat. */
  sent?: boolean;
}

export interface SideQuestionPanelProps {
  items: SideQuestionItem[];
  onAsk: (question: string) => void;
  /** Sends an answered exchange into the agent's chat. */
  onSend: (id: string) => void;
  onClear?: () => void;
  /** Renders answers; plain text when omitted. */
  renderMarkdown?: (text: string, className?: string) => ReactNode;
  hint?: ReactNode;
  /** Longest question the host accepts. */
  maxLength?: number;
}

/**
 * Ask a working agent a quick question off to the side: the exchanges so far,
 * each answered one sendable into the main chat, and a field to ask another.
 */
export function SideQuestionPanel({
  items,
  onAsk,
  onSend,
  onClear,
  renderMarkdown,
  hint = "Answered from a read-only copy of the agent's context. Nothing is added to its chat.",
  maxLength = 4000,
}: SideQuestionPanelProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the newest exchange in view as questions are asked and answered.
  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items]);

  const ask = () => {
    const question = draft.trim();
    if (!question) {
      return;
    }
    onAsk(question);
    setDraft("");
  };

  return (
    <div className={styles.panel}>
      <div className={styles.hintRow}>
        <span className={styles.hint}>{hint}</span>
        {onClear && items.length > 0 && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>

      {items.length > 0 && (
        <div ref={listRef} className={styles.list}>
          {items.map((item) => (
            <div key={item.id} className={styles.exchange}>
              <div className={styles.question}>{item.question}</div>
              {item.pending && (
                <div className={styles.thinking}>
                  <Spinner size="xs" tone="muted" aria-label="Thinking" />
                  Thinking…
                </div>
              )}
              {item.error && <div className={styles.error}>{item.error}</div>}
              {item.answer !== undefined && (
                <>
                  <div className={styles.answer}>
                    {renderMarkdown ? (
                      renderMarkdown(item.answer)
                    ) : (
                      <span className={styles.plain}>{item.answer}</span>
                    )}
                  </div>
                  <div className={styles.actions}>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={item.sent}
                      title={
                        item.sent
                          ? undefined
                          : "Send this question and answer to the agent"
                      }
                      onClick={() => onSend(item.id)}
                    >
                      {item.sent ? "Sent" : "Send to agent"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <form
        className={styles.ask}
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <Input
          aria-label="Side question"
          className={styles.field}
          maxLength={maxLength}
          placeholder="Ask a side question"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" disabled={!draft.trim()}>
          Ask
        </Button>
      </form>
    </div>
  );
}
