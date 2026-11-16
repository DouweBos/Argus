import { type FormEvent, useState } from "react";
import { LockIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { Input } from "../Input/Input";
import styles from "./SecretRequestForm.module.css";

export interface SecretRequestFormProps {
  /** What the agent needs, e.g. "adb pairing code". */
  label: string;
  /** Why it needs it. */
  reason?: string;
  /** Where the value ends up, in words. */
  destination: string;
  onSubmit: (value: string) => void;
  onDecline: () => void;
}

/**
 * An agent's `request_secret` card: a masked field whose value goes to the
 * host alone, never into the chat. Clears itself on submit.
 */
export function SecretRequestForm({
  label,
  reason,
  destination,
  onSubmit,
  onDecline,
}: SecretRequestFormProps) {
  const [value, setValue] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value) {
      return;
    }
    const sent = value;
    setValue("");
    onSubmit(sent);
  };

  return (
    <form className={styles.wrap} onSubmit={submit} autoComplete="off">
      <div className={styles.title}>
        <LockIcon size={12} />
        <span>{label}</span>
      </div>
      {reason && <p className={styles.reason}>{reason}</p>}
      <Input
        mono
        type="password"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <p className={styles.note}>{destination} It never appears in the chat.</p>
      <div className={styles.actions}>
        <Button type="submit" variant="primary" size="sm" disabled={!value}>
          Send securely
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDecline}>
          Decline
        </Button>
      </div>
    </form>
  );
}
