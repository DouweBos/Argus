import type { DeviceClaimState } from "../../../hooks/useDeviceClaim";
import { useCallback, useEffect, useState } from "react";
import { error } from "@logger";
import { useDeviceInput } from "../../../hooks/useDeviceInput";
import { simulatorButton } from "../../../lib/ipc";
import styles from "./AppleTVRemote.module.css";

type Button =
  | "down"
  | "left"
  | "menu"
  | "playpause"
  | "right"
  | "select"
  | "up";

/** Conductor spells play/pause in camelCase; the rest of the names match. */
const CONDUCTOR_BUTTON: Record<Button, string> = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  select: "select",
  menu: "menu",
  playpause: "playPause",
};

function resolveClickpadButton(e: React.PointerEvent<HTMLDivElement>): Button {
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

type ClickpadZone = Exclude<Button, "menu" | "playpause">;

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

interface AppleTVRemoteProps {
  /** Input arbitration on the host. Omitted where nothing can contend for it. */
  claim?: DeviceClaimState;
  udid: string;
}

export function AppleTVRemote({ claim, udid }: AppleTVRemoteProps) {
  const [activeButton, setActiveButton] = useState<Button | null>(null);
  const [hoveredZone, setHoveredZone] = useState<ClickpadZone | null>(null);

  const blocked = claim?.blocked ?? false;
  const reportInputError = claim?.reportInputError;

  // tvOS ignores the simulator bridge's keyboard-emulated remote, so drive the
  // real remote through conductor when its socket is up. The bridge stays as
  // the fallback for when conductor can't serve this device.
  const { capabilities, client, ready } = useDeviceInput(udid, !blocked);
  const useConductor =
    ready && client !== null && (capabilities?.tvRemote ?? false);

  const press = useCallback(
    (button: Button) => {
      if (blocked) {
        return;
      }
      setActiveButton(button);
      setTimeout(() => setActiveButton(null), 150);

      if (useConductor) {
        client.tvremote(CONDUCTOR_BUTTON[button]);

        return;
      }

      simulatorButton(udid, button).catch((err) => {
        // A refusal means someone else took the device — say so rather than
        // dropping the press into the log.
        if (!reportInputError?.(err)) {
          error("[Remote] button failed:", err);
        }
      });
    },
    [blocked, client, reportInputError, udid, useConductor],
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
      let button: Button | null = null;
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
