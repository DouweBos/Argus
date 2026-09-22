import { useCallback, useEffect, useState } from "react";
import styles from "./AppleTVRemote.module.css";

/** Every press the Siri Remote can send. */
export type TvRemoteButton =
  | "down"
  | "left"
  | "menu"
  | "playpause"
  | "right"
  | "select"
  | "up";

function resolveClickpadButton(
  e: React.PointerEvent<HTMLDivElement>,
): TvRemoteButton {
  const rect = e.currentTarget.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const dx = e.clientX - rect.left - cx;
  const dy = e.clientY - rect.top - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const radius = rect.width / 2;

  if (dist < radius * 0.35) {
    return "select";
  }

  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle >= -45 && angle < 45) {
    return "right";
  }
  if (angle >= 45 && angle < 135) {
    return "down";
  }
  if (angle >= -135 && angle < -45) {
    return "up";
  }

  return "left";
}

type ClickpadZone = Exclude<TvRemoteButton, "menu" | "playpause">;

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
  if (el.closest(".xterm")) {
    return true;
  }

  return false;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && isEditableElement(target);
}

export interface AppleTVRemoteProps {
  /** Someone else holds the device: the remote dims and stops taking presses. */
  blocked?: boolean;
  /** Send the press. Where it goes is the caller's business (IPC or gateway). */
  onPress: (button: TvRemoteButton) => void;
}

/**
 * Siri Remote for a tvOS device: a clickpad that resolves a press to a
 * direction, Menu and Play/Pause, and the arrow-key shortcuts that go with
 * them. Presentational — every surface driving a TV renders this one.
 */
export function AppleTVRemote({
  blocked = false,
  onPress,
}: AppleTVRemoteProps) {
  const [activeButton, setActiveButton] = useState<TvRemoteButton | null>(null);
  const [hoveredZone, setHoveredZone] = useState<ClickpadZone | null>(null);

  const press = useCallback(
    (button: TvRemoteButton) => {
      if (blocked) {
        return;
      }
      setActiveButton(button);
      setTimeout(() => setActiveButton(null), 150);
      onPress(button);
    },
    [blocked, onPress],
  );

  const handleClickpad = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      press(resolveClickpadButton(e));
    },
    [press],
  );

  const handleClickpadMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      setHoveredZone(resolveClickpadButton(e) as ClickpadZone);
    },
    [],
  );

  const handleClickpadLeave = useCallback(() => {
    setHoveredZone(null);
  }, []);

  const zoneClass = (zone: ClickpadZone, variant: string) => {
    const classes = [styles.zone, variant];
    if (activeButton === zone) {
      classes.push(styles.active);
    } else if (hoveredZone === zone) {
      classes.push(styles.hovered);
    }

    return classes.join(" ");
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        isEditableTarget(e.target) ||
        isEditableElement(document.activeElement)
      ) {
        return;
      }
      let button: TvRemoteButton | null = null;
      switch (e.key) {
        case "ArrowUp":
          button = "up";
          break;
        case "ArrowDown":
          button = "down";
          break;
        case "ArrowLeft":
          button = "left";
          break;
        case "ArrowRight":
          button = "right";
          break;
        case "Enter":
          button = "select";
          break;
        case "Escape":
          button = "menu";
          break;
        case " ":
          button = "playpause";
          break;
      }

      if (button) {
        e.preventDefault();
        press(button);
      }
    };

    window.addEventListener("keydown", handler);

    return () => window.removeEventListener("keydown", handler);
  }, [press]);

  return (
    <div className={`${styles.remote} ${blocked ? styles.blocked : ""}`}>
      <div
        className={styles.clickpad}
        onPointerDown={handleClickpad}
        onPointerLeave={handleClickpadLeave}
        onPointerMove={handleClickpadMove}
      >
        <div className={zoneClass("up", styles.zoneUp)} />
        <div className={zoneClass("down", styles.zoneDown)} />
        <div className={zoneClass("left", styles.zoneLeft)} />
        <div className={zoneClass("right", styles.zoneRight)} />
        <div className={zoneClass("select", styles.zoneSelect)} />
        <span className={`${styles.arrow} ${styles.arrowUp}`}>▲</span>
        <span className={`${styles.arrow} ${styles.arrowDown}`}>▼</span>
        <span className={`${styles.arrow} ${styles.arrowLeft}`}>◀</span>
        <span className={`${styles.arrow} ${styles.arrowRight}`}>▶</span>
      </div>
      <div className={styles.buttons}>
        <button
          className={`${styles.button} ${activeButton === "menu" ? styles.active : ""}`}
          onPointerDown={() => press("menu")}
        >
          Menu
        </button>
        <button
          className={`${styles.button} ${activeButton === "playpause" ? styles.active : ""}`}
          onPointerDown={() => press("playpause")}
        >
          ▶❚❚
        </button>
      </div>
    </div>
  );
}
