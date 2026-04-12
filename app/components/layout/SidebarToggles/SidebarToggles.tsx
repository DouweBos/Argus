import {
  toggleLeftSidebar,
  useLeftSidebarVisible,
} from "../../../stores/layoutStore";
import { LeftSidebarIcon } from "../../shared/Icons";
import styles from "./SidebarToggles.module.css";

export function SidebarToggles() {
  const leftVisible = useLeftSidebarVisible();
  const toggleLeft = toggleLeftSidebar;

  return (
    <div className={styles.toggles}>
      <button
        aria-label={leftVisible ? "Hide left sidebar" : "Show left sidebar"}
        className={`${styles.toggle} ${leftVisible ? styles.active : ""}`}
        title={leftVisible ? "Hide left sidebar" : "Show left sidebar"}
        onClick={toggleLeft}
      >
        <LeftSidebarIcon />
      </button>
    </div>
  );
}
