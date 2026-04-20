import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGlobalShortcuts } from "../../hooks/useGlobalShortcuts";
import { useIpcEvent } from "../../hooks/useIpcEvent";

/**
 * Wires navigation-related side effects inside the Router context:
 *   - back/forward keyboard shortcuts (Cmd+[ / Cmd+])
 *   - mouse back/forward buttons (browser default)
 *   - `navigation:goto` IPC events from the main process (deep links)
 */
export function NavigationDeepLinkBridge() {
  const navigate = useNavigate();

  useGlobalShortcuts([
    {
      key: "[",
      meta: true,
      handler: () => navigate(-1),
    },
    {
      key: "]",
      meta: true,
      handler: () => navigate(1),
    },
  ]);

  useIpcEvent<{ path: string }>("navigation:goto", ({ path }) => {
    if (path) {
      navigate(path);
    }
  });

  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        navigate(-1);
      } else if (e.button === 4) {
        e.preventDefault();
        navigate(1);
      }
    };
    window.addEventListener("mouseup", onMouse);

    return () => window.removeEventListener("mouseup", onMouse);
  }, [navigate]);

  return null;
}
