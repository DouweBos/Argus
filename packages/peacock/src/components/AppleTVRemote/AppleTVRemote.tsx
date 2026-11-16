import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AndroidBackIcon,
  ChevronRightIcon,
  HomeIcon,
  PlayPauseIcon,
  RemoteMenuIcon,
} from "../../icons/Icons";
import styles from "./AppleTVRemote.module.css";

/** Every press a TV remote can send. */
export type TvRemoteButton =
  | "back"
  | "down"
  | "home"
  | "left"
  | "menu"
  | "playpause"
  | "right"
  | "select"
  | "up";

type Direction = "down" | "left" | "right" | "up";

const DIRECTIONS: Direction[] = ["up", "right", "down", "left"];

function isEditableElement(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) {
    return false;
  }
  if (el.isContentEditable) {
    return true;
  }
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }

  return el.closest(".xterm") !== null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && isEditableElement(target);
}

export interface AppleTVRemoteProps {
  /** Someone else holds the device: the remote dims and stops taking presses. */
  blocked?: boolean;
  /** Android TV has no Menu / Play-Pause pair; it gets Back instead. */
  android?: boolean;
  /** Send the press. Where it goes is the caller's business (IPC or gateway). */
  onPress: (button: TvRemoteButton) => void;
}

/**
 * TV remote: a clickpad (four directions and Select), the platform's
 * hardware buttons, and the arrow-key shortcuts that go with them. Mirrors
 * the Mac app's remote so every surface driving a TV looks the same.
 */
export function AppleTVRemote({
  blocked = false,
  android = false,
  onPress,
}: AppleTVRemoteProps) {
  const [active, setActive] = useState<TvRemoteButton | null>(null);

  // The stream is a second or so behind, so flash the press or it looks lost.
  const press = useCallback(
    (button: TvRemoteButton) => {
      if (blocked) {
        return;
      }
      setActive(button);
      setTimeout(() => setActive((a) => (a === button ? null : a)), 150);
      onPress(button);
    },
    [blocked, onPress],
  );

  useEffect(() => {
    const keys: Record<string, TvRemoteButton> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      Enter: "select",
      Escape: android ? "back" : "menu",
      ...(android ? {} : { " ": "playpause" as const }),
    };
    const handler = (e: KeyboardEvent) => {
      if (
        isEditableTarget(e.target) ||
        isEditableElement(document.activeElement)
      ) {
        return;
      }
      const button = keys[e.key];
      if (button) {
        e.preventDefault();
        press(button);
      }
    };
    window.addEventListener("keydown", handler);

    return () => window.removeEventListener("keydown", handler);
  }, [press, android]);

  const hardware: { id: TvRemoteButton; label: string; icon: ReactNode }[] =
    android
      ? [
          { id: "back", label: "Back", icon: <AndroidBackIcon size={16} /> },
          { id: "home", label: "Home", icon: <HomeIcon size={16} /> },
        ]
      : [
          { id: "menu", label: "Menu", icon: <RemoteMenuIcon size={16} /> },
          {
            id: "playpause",
            label: "Play/Pause",
            icon: <PlayPauseIcon size={16} />,
          },
          { id: "home", label: "Home", icon: <HomeIcon size={16} /> },
        ];

  const pressed = (id: TvRemoteButton) => (active === id ? styles.active : "");

  return (
    <div className={`${styles.remote} ${blocked ? styles.blocked : ""}`}>
      <div className={styles.clickpad}>
        {DIRECTIONS.map((d) => (
          <button
            key={d}
            aria-label={d[0]!.toUpperCase() + d.slice(1)}
            className={`${styles.arrow} ${styles[d]} ${pressed(d)}`}
            type="button"
            onPointerDown={() => press(d)}
          >
            <ChevronRightIcon size={20} />
          </button>
        ))}
        <button
          aria-label="Select"
          className={`${styles.select} ${pressed("select")}`}
          type="button"
          onPointerDown={() => press("select")}
        />
      </div>
      <div className={styles.buttons}>
        {hardware.map((b) => (
          <button
            key={b.id}
            aria-label={b.label}
            className={`${styles.button} ${pressed(b.id)}`}
            title={b.label}
            type="button"
            onPointerDown={() => press(b.id)}
          >
            {b.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
