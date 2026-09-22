import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styles from "./DialogBody.module.css";

interface DialogBodyOwnProps {
  children: ReactNode;
  /** Drop the standard padding — for `size="full"` shells whose panes pad themselves. */
  flush?: boolean;
}

/** Render as a `<form>` so submit-on-enter works. Default `"div"`. */
export type DialogBodyProps = DialogBodyOwnProps &
  (
    | (ComponentPropsWithoutRef<"div"> & { as?: "div" })
    | (ComponentPropsWithoutRef<"form"> & { as: "form" })
  );

/**
 * Padded, scrollable content area for a `Dialog`. Its horizontal inset matches
 * the dialog header, so fields line up with the title.
 */
export function DialogBody({
  as = "div",
  children,
  className,
  flush = false,
  ...rest
}: DialogBodyProps) {
  const cls = [styles.body, flush && styles.flush, className]
    .filter(Boolean)
    .join(" ");
  // div and form share no common props type, so the tag and its props are
  // narrowed together in one cast at the boundary.
  const Tag = as as "div";
  const props = rest as ComponentPropsWithoutRef<"div">;

  return (
    <Tag className={cls} {...props}>
      {children}
    </Tag>
  );
}
