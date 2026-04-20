import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icons } from "@argus/peacock";
import styles from "./NavigationButtons.module.css";

/**
 * Back/forward chrome buttons. React Router's memory history doesn't expose
 * a directional length, so we track history delta locally via a global
 * "router:navigated" event fired from useRouteSync. Buttons disable when
 * there's nothing to go to in that direction.
 */
export function NavigationButtons() {
  const navigate = useNavigate();
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);

  useEffect(() => {
    const update = (e: Event) => {
      const detail = (e as CustomEvent<HistoryDelta>).detail;
      setCanBack(detail.canBack);
      setCanForward(detail.canForward);
    };
    window.addEventListener("router:historychange", update as EventListener);

    return () =>
      window.removeEventListener(
        "router:historychange",
        update as EventListener,
      );
  }, []);

  const onBack = useCallback(() => {
    if (canBack) {
      navigate(-1);
    }
  }, [canBack, navigate]);

  const onForward = useCallback(() => {
    if (canForward) {
      navigate(1);
    }
  }, [canForward, navigate]);

  return (
    <div className={styles.group}>
      <button
        aria-label="Back"
        className={styles.btn}
        disabled={!canBack}
        onClick={onBack}
        type="button"
      >
        <Icons.ArrowBackIcon size={12} />
      </button>
      <button
        aria-label="Forward"
        className={styles.btn}
        disabled={!canForward}
        onClick={onForward}
        type="button"
      >
        <Icons.ArrowForwardIcon size={12} />
      </button>
    </div>
  );
}

interface HistoryDelta {
  canBack: boolean;
  canForward: boolean;
}
