import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { forwardRef } from "react";
import styles from "./Input.module.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  bare?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { mono, bare, className, ...rest },
  ref,
) {
  const classes = [
    styles.input,
    mono ? styles.mono : "",
    bare ? styles.bare : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return <input ref={ref} className={classes} {...rest} />;
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
  bare?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ mono, bare, className, ...rest }, ref) {
    const classes = [
      styles.input,
      styles.textarea,
      mono ? styles.mono : "",
      bare ? styles.bare : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    return <textarea ref={ref} className={classes} {...rest} />;
  },
);
