import {
  forwardRef,
  type ChangeEventHandler,
  type HTMLAttributes,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";
import { SendIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import styles from "./ChatInput.module.css";

export interface ChatInputProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange" | "onSubmit"
> {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  /** Pills / chips displayed left of the send button (e.g., model picker, plan mode). */
  actions?: ReactNode;
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    {
      value,
      placeholder = "Ask the agent to…",
      disabled,
      onChange,
      onSubmit,
      actions,
      className,
      ...rest
    },
    ref,
  ) {
    const handleChange: ChangeEventHandler<HTMLTextAreaElement> = (e) =>
      onChange(e.target.value);

    const handleKey: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        onSubmit?.();
      }
    };

    return (
      <div
        className={[styles.wrap, className].filter(Boolean).join(" ")}
        {...rest}
      >
        <textarea
          ref={ref}
          className={styles.textarea}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          rows={2}
          onChange={handleChange}
          onKeyDown={handleKey}
        />
        <div className={styles.bar}>
          <div className={styles.left}>{actions}</div>
          <Button
            variant="send"
            aria-label="Send"
            disabled={disabled || !value.trim()}
            onClick={onSubmit}
          >
            <SendIcon size={13} />
          </Button>
        </div>
      </div>
    );
  },
);
