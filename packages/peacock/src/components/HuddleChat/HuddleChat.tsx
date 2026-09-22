import type { KeyboardEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SendIcon } from "../../icons/Icons";
import { Avatar } from "../Avatar/Avatar";
import styles from "./HuddleChat.module.css";

export interface HuddleChatItem {
  id: string;
  author: string;
  text: string;
  /** Unix ms. */
  at: number;
  /** Ours — rendered without the avatar, since we know who we are. */
  mine?: boolean;
}

export interface HuddleChatProps {
  messages: HuddleChatItem[];
  onSend: (text: string) => void;
  /** Shown before anyone has said anything. */
  emptyLabel?: string;
  placeholder?: string;
  /** Hides the composer — a reader who has lost the room can still scroll it. */
  readOnly?: boolean;
  className?: string;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Runs of messages from one person within this long collapse into one block. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

function startsBlock(
  message: HuddleChatItem,
  previous: HuddleChatItem | undefined,
): boolean {
  return (
    !previous ||
    previous.author !== message.author ||
    message.at - previous.at > GROUP_WINDOW_MS
  );
}

/**
 * The side chat in a huddle: what the people in the room say to each other,
 * next to what they say to the agent.
 *
 * Deliberately plain next to the agent transcript — no tool calls, no
 * markdown, no attachments. It exists so nobody has to leave for Slack to ask
 * "which build is this?", and anything richer than that belongs in the agent
 * conversation instead.
 */
export function HuddleChat({
  messages,
  onSend,
  emptyLabel = "No messages yet. Say something to the room.",
  placeholder = "Message the room…",
  readOnly = false,
  className,
}: HuddleChatProps) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  // Only follow the tail when they are already reading it — yanking someone
  // back down while they scroll up to re-read something is worse than a
  // missed line, and the unread count tells them anyway.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (log && atBottom.current) {
      log.scrollTop = log.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const log = logRef.current;
    if (!log) {
      return;
    }
    const onScroll = () => {
      atBottom.current =
        log.scrollHeight - log.scrollTop - log.clientHeight < 32;
    };
    log.addEventListener("scroll", onScroll);

    return () => log.removeEventListener("scroll", onScroll);
  }, []);

  const send = () => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    onSend(text);
    setDraft("");
    atBottom.current = true;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")}>
      <div ref={logRef} className={styles.log}>
        {messages.length === 0 && <p className={styles.empty}>{emptyLabel}</p>}
        {messages.map((message, i) => {
          const fresh = startsBlock(message, messages[i - 1]);

          return (
            <div
              key={message.id}
              className={[styles.row, fresh ? styles.fresh : styles.continued]
                .filter(Boolean)
                .join(" ")}
            >
              <span className={styles.gutter}>
                {fresh && !message.mine && (
                  <Avatar name={message.author} size={20} />
                )}
              </span>
              <span className={styles.body}>
                {fresh && (
                  <span className={styles.meta}>
                    <span className={styles.author}>
                      {message.mine ? "You" : message.author}
                    </span>
                    <span className={styles.time}>
                      {formatTime(message.at)}
                    </span>
                  </span>
                )}
                <span className={styles.text}>{message.text}</span>
              </span>
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <div className={styles.composer}>
          <textarea
            aria-label="Message the room"
            className={styles.input}
            placeholder={placeholder}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            aria-label="Send to the room"
            className={styles.send}
            disabled={!draft.trim()}
            title="Send to the room"
            type="button"
            onClick={send}
          >
            <SendIcon size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
