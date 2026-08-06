import { type ReactNode, useEffect } from "react";
import { MemoryRouter } from "react-router-dom";

interface PopoutRootProps {
  children: ReactNode;
  /** Route the popout's in-memory history starts on (drives `useRouteSessionId` et al). */
  initialPath?: string;
}

/**
 * Shell every popout window renders inside. Popouts reuse main-window
 * components, and those read the current route through `useLocation()` — with
 * no router in the tree the whole window renders blank. A `MemoryRouter` gives
 * them a real (window-local) history without touching the main window's URL.
 */
export function PopoutRoot({ children, initialPath = "/" }: PopoutRootProps) {
  useEffect(() => {
    document.body.classList.add("argus-popout");

    return () => {
      document.body.classList.remove("argus-popout");
    };
  }, []);

  return <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>;
}
