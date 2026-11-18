import { useState, type ReactNode } from "react";
import { ArgusMark } from "../../icons/Icons";
import { Avatar } from "../Avatar/Avatar";
import { Button } from "../Button/Button";
import { Disclosure } from "../Disclosure/Disclosure";
import { Input } from "../Input/Input";
import { Spinner } from "../Spinner/Spinner";
import { StatusBulb } from "../StatusBulb/StatusBulb";
import { Stepper } from "../Stepper/Stepper";
import styles from "./HuddleJoin.module.css";

const STEPS = [
  { id: "name", label: "Your name" },
  { id: "host", label: "Approval" },
  { id: "join", label: "Huddle" },
];

/** The page around every screen a guest sees before the huddle opens. */
export function HuddleJoinShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <div className={styles.glow} aria-hidden />
      <header className={styles.brand}>
        <ArgusMark size={22} />
        <span>Argus huddle</span>
      </header>
      <main className={styles.card}>{children}</main>
    </div>
  );
}

export interface HuddleJoinProps {
  /** `name` asks for one; `waiting` is the host deciding; `connecting` is before either. */
  step: "connecting" | "name" | "waiting";
  /** Prefill, or the name already sent while waiting. */
  name?: string;
  onJoin?: (name: string) => void;
}

/**
 * A guest's way into a huddle: their name, a preview of the request the host
 * will see, and what being let in means — then the wait for the host.
 */
export function HuddleJoin({ step, name = "", onJoin }: HuddleJoinProps) {
  const [draft, setDraft] = useState(name);
  const trimmed = draft.trim();
  const submit = () => {
    if (trimmed) {
      onJoin?.(trimmed);
    }
  };

  if (step !== "name") {
    const waiting = step === "waiting";

    return (
      <div className={styles.stack}>
        <Stepper className={styles.stepper} currentIndex={1} steps={STEPS} />
        <div className={styles.waiting}>
          {name ? (
            <span className={styles.ring}>
              <Avatar name={name} size={56} />
            </span>
          ) : (
            <Spinner />
          )}
          <h1 className={styles.title}>
            {waiting ? "Waiting for the host" : "Connecting to the huddle"}
          </h1>
          {waiting && (
            <p className={styles.body}>
              Nothing is shared until they let you in — you'll drop straight
              into the huddle when they do.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <form
      className={styles.stack}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Stepper className={styles.stepper} currentIndex={0} steps={STEPS} />
      <div className={styles.heading}>
        <h1 className={styles.title}>You're invited to a huddle</h1>
        <p className={styles.body}>
          Follow the host's agent, chat with the room and drive their device
          together. The host sees your name when they decide whether to let you
          in.
        </p>
      </div>

      <Input
        autoFocus
        aria-label="Your name"
        className={styles.input}
        placeholder="Your name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />

      <div className={styles.preview} aria-label="What the host sees">
        <span className={styles.previewLabel}>The host sees</span>
        <div className={styles.request}>
          <StatusBulb size="sm" tone="pending" />
          <Avatar name={trimmed || "?"} size={22} />
          <span className={trimmed ? styles.who : styles.whoEmpty}>
            {trimmed || "Your name"}
          </span>
          <span className={styles.status}>Asking to join</span>
        </div>
      </div>

      <Button disabled={!trimmed} size="lg" type="submit" variant="primary">
        Ask to join
      </Button>

      <Disclosure toggleLabel="What you can do in a huddle">
        <ul className={styles.points}>
          <li>
            Read the shared agent's conversation and send it messages, like the
            host can.
          </li>
          <li>Chat with everyone in the room.</li>
          <li>Drive the host's device when they share one.</li>
          <li>
            Nothing else: the host's other agents and projects stay out of
            reach, and your access ends with the huddle.
          </li>
        </ul>
      </Disclosure>
    </form>
  );
}
