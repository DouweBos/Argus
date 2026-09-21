import type { AppView } from "../../../lib/router";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { SidebarItem } from "@argus/peacock";
import { appNavigate, parseRoute } from "../../../lib/router";

interface SidebarNavItemProps {
  attention?: boolean;
  children: ReactNode;
  count?: ReactNode;
  leading?: ReactNode;
  view: Exclude<AppView, "notifications" | "session">;
}

export function SidebarNavItem({
  view,
  leading,
  count,
  attention,
  children,
}: SidebarNavItemProps) {
  const location = useLocation();
  const route = parseRoute(location.pathname);
  const active = route.view === view;

  return (
    <SidebarItem
      active={active}
      attention={attention}
      leading={leading}
      count={count}
      onClick={() => appNavigate({ view })}
    >
      {children}
    </SidebarItem>
  );
}
