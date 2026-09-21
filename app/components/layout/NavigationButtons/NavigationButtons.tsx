import { Icons } from "@argus/peacock";
import {
  goBackInTab,
  goForwardInTab,
  useCanGoBack,
  useCanGoForward,
} from "../../../stores/tabStore";
import styles from "./NavigationButtons.module.css";

/**
 * Back/forward chrome buttons. History is per window tab — one global stack
 * would interleave the screens of two machines — so these read the active
 * tab's stacks rather than the router's.
 */
export function NavigationButtons() {
  const canBack = useCanGoBack();
  const canForward = useCanGoForward();

  return (
    <div className={styles.group}>
      <button
        aria-label="Back"
        className={styles.btn}
        disabled={!canBack}
        onClick={goBackInTab}
        type="button"
      >
        <Icons.ArrowBackIcon size={12} />
      </button>
      <button
        aria-label="Forward"
        className={styles.btn}
        disabled={!canForward}
        onClick={goForwardInTab}
        type="button"
      >
        <Icons.ArrowForwardIcon size={12} />
      </button>
    </div>
  );
}
