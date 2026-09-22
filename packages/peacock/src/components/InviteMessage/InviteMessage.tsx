import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import styles from "./InviteMessage.module.css";

export interface InviteMessageProps {
  /** The full message, shown and copied — wrapped, not truncated. */
  message: string;
  /** The bare link behind it, offered as a second, smaller copy. */
  link?: string;
  /** Shown in place of the message while it is still being produced. */
  placeholder?: string;
  className?: string;
}

/**
 * A ready-to-paste invitation, shown as the words that will land in the other
 * person's chat rather than as a field they have to imagine pasting.
 *
 * Copying the sentence is the primary action because a bare link tells the
 * recipient nothing; the link on its own stays available for the times they
 * are writing their own message around it.
 */
export function InviteMessage({
  message,
  link,
  placeholder = "…",
  className,
}: InviteMessageProps) {
  const [copied, setCopied] = useState<"link" | "message" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const copy = (text: string, which: "link" | "message") => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(which);
        if (timer.current) {
          clearTimeout(timer.current);
        }
        timer.current = setTimeout(() => setCopied(null), 1400);
      })
      .catch(() => {});
  };

  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")}>
      <p className={message ? styles.message : styles.pending}>
        {message || placeholder}
      </p>
      <div className={styles.actions}>
        <Button
          disabled={!message}
          leading={
            copied === "message" ? (
              <CheckIcon size={12} />
            ) : (
              <CopyIcon size={12} />
            )
          }
          size="sm"
          variant="primary"
          onClick={() => copy(message, "message")}
        >
          {copied === "message" ? "Copied" : "Copy invite"}
        </Button>
        {link && (
          <Button size="sm" variant="ghost" onClick={() => copy(link, "link")}>
            {copied === "link" ? "Copied" : "Copy link only"}
          </Button>
        )}
      </div>
    </div>
  );
}
