import { useLayoutStore } from "../../stores/layoutStore";
import { LeftSidebarIcon, RightSidebarIcon } from "../shared/Icons";
import styles from "./SidebarToggles.module.css";

export function SidebarToggles() {
  const leftVisible = useLayoutStore((s) => s.leftSidebarVisible);
  const rightVisible = useLayoutStore((s) => s.rightSidebarVisible);
  const toggleLeft = useLayoutStore((s) => s.toggleLeftSidebar);
  const toggleRight = useLayoutStore((s) => s.toggleRightSidebar);

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
      <button
        className={`${styles.toggle} ${rightVisible ? styles.active : ""}`}
        onClick={toggleRight}
        title={rightVisible ? "Hide right sidebar" : "Show right sidebar"}
        aria-label={rightVisible ? "Hide right sidebar" : "Show right sidebar"}
      >
        <RightSidebarIcon />
      </button>
    </div>
  );
}
