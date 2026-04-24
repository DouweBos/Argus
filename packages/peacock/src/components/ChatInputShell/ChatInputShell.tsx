import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import styles from "./ChatInputShell.module.css";

export interface ChatInputShellProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  /** The textarea or input element — owned by the consumer. */
  children: ReactNode;
  /**
   * Content rendered inside the card, above the textarea area. Intended for
   * attachment strips, autocomplete popups, and mention pickers. Absolutely
   * positioned popups use the shell as their positioning context.
   */
  above?: ReactNode;
  /** Toolbar content on the left side of the bottom bar (chips, meta). */
  actions?: ReactNode;
  /** Toolbar content on the right side of the bottom bar (send/stop etc). */
  trailing?: ReactNode;
  /** Dims the card to indicate a disabled state. */
  disabled?: boolean;
  /** Shows the drag-over accent glow. Drive from your own drag state. */
  dragOver?: boolean;
}

interface ChatInputShellComponent extends React.ForwardRefExoticComponent<
  ChatInputShellProps & React.RefAttributes<HTMLDivElement>
> {
  /**
   * Wrap chip/button label text with this so it collapses to just the icon
   * when the shell is narrower than ~420px.
   */
  CollapseLabel: typeof CollapseLabel;
}

function CollapseLabel({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={[styles.collapseLabel, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </span>
  );
}

const ChatInputShellBase = forwardRef<HTMLDivElement, ChatInputShellProps>(
  function ChatInputShell(
    {
      children,
      above,
      actions,
      trailing,
      disabled,
      dragOver,
      className,
      ...rest
    },
    ref,
  ) {
    const hasBar = actions !== undefined || trailing !== undefined;

    return (
      <div
        ref={ref}
        className={[
          styles.shell,
          disabled && styles.disabled,
          dragOver && styles.dragOver,
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      >
        {above}
        <div className={styles.body}>{children}</div>
        {hasBar && (
          <div className={styles.bar}>
            <div className={styles.actions}>{actions}</div>
            <div className={styles.trailing}>{trailing}</div>
          </div>
        )}
      </div>
    );
  },
);

export const ChatInputShell = ChatInputShellBase as ChatInputShellComponent;
ChatInputShell.CollapseLabel = CollapseLabel;
