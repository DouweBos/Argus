import { useLayoutStore } from "../../stores/layoutStore";
import { LeftSidebarIcon } from "../shared/Icons";
import styles from "./SidebarToggles.module.css";

export function SidebarToggles() {
  const leftVisible = useLayoutStore((s) => s.leftSidebarVisible);
  const toggleLeft = useLayoutStore((s) => s.toggleLeftSidebar);

  return (
    <div className={styles.toggles}>
      <button
        className={`${styles.toggle} ${leftVisible ? styles.active : ""}`}
        onClick={toggleLeft}
        title={leftVisible ? "Hide left sidebar" : "Show left sidebar"}
        aria-label={leftVisible ? "Hide left sidebar" : "Show left sidebar"}
      >
        <LeftSidebarIcon />
      </button>
    </div>
  );
}
