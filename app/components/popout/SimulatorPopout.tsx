import { useEffect } from "react";
import { RuntimeView } from "../runtime/SimulatorView/RuntimeView";
import styles from "./SimulatorPopout.module.css";
import { POPOUT_SESSION_ID } from "./seedPopoutStore";

/**
 * Floating always-on-top simulator window. Renders the shared RuntimeView so
 * the popout gets the full platform toggle (iOS / Android / Web), the device
 * picker, and the platform-specific simulator chrome (including the Apple TV
 * remote for tvOS). The popout variant hides the expand / popout toggles
 * since the window itself is already the floating view.
 */
export function SimulatorPopout() {
  useEffect(() => {
    document.body.classList.add("argus-popout");

    return () => {
      document.body.classList.remove("argus-popout");
    };
  }, []);

  return (
    <div className={styles.root}>
      <div className={styles.dragRegion} />
      <RuntimeView sessionId={POPOUT_SESSION_ID} variant="popout" />
    </div>
  );
}
