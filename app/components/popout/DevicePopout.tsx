import { RuntimeView } from "../runtime/SimulatorView/RuntimeView";
import styles from "./DevicePopout.module.css";
import { POPOUT_SESSION_ID } from "./seedPopoutStore";

/**
 * Floating always-on-top device window. Renders the shared RuntimeView so the
 * popout gets the full target picker and the platform-specific chrome — iOS /
 * Android simulators, the Apple TV remote for tvOS, and video inputs (capture
 * cards). The popout variant hides the expand / popout toggles since the
 * window itself is already the floating view.
 */
export function DevicePopout() {
  return (
    <div className={styles.root}>
      <div className={styles.dragRegion} />
      <RuntimeView sessionId={POPOUT_SESSION_ID} variant="popout" />
    </div>
  );
}
