import { useCallback, useEffect, useState } from "react";
import { simulatorButton } from "../../lib/ipc";
import styles from "./AppleTVRemote.module.css";

type Button =
  | "down"
  | "left"
  | "menu"
  | "playpause"
  | "right"
  | "select"
  | "up";

function resolveClickpadButton(e: React.PointerEvent<HTMLDivElement>): Button {
  const rect = e.currentTarget.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const dx = e.clientX - rect.left - cx;
  const dy = e.clientY - rect.top - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const radius = rect.width / 2;

  if (dist < radius * 0.35) return "select";

  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle >= -45 && angle < 45) return "right";
  if (angle >= 45 && angle < 135) return "down";
  if (angle >= -135 && angle < -45) return "up";
  return "left";
}

export function AppleTVRemote() {
  const [activeButton, setActiveButton] = useState<Button | null>(null);

  const press = useCallback((button: Button) => {
    setActiveButton(button);
    setTimeout(() => setActiveButton(null), 150);
    simulatorButton(button).catch((err) =>
      console.error("[Remote] button failed:", err),
    );
  }, []);

  const handleClickpad = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      press(resolveClickpadButton(e));
    },
    [press],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
    <div className={styles.remote}>
      <div className={styles.clickpad} onPointerDown={handleClickpad}>
        <div
          className={`${styles.zone} ${styles.zoneUp} ${activeButton === "up" ? styles.active : ""}`}
        />
        <div
          className={`${styles.zone} ${styles.zoneDown} ${activeButton === "down" ? styles.active : ""}`}
        />
        <div
          className={`${styles.zone} ${styles.zoneLeft} ${activeButton === "left" ? styles.active : ""}`}
        />
        <div
          className={`${styles.zone} ${styles.zoneRight} ${activeButton === "right" ? styles.active : ""}`}
        />
        <div
          className={`${styles.zone} ${styles.zoneSelect} ${activeButton === "select" ? styles.active : ""}`}
        />
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
