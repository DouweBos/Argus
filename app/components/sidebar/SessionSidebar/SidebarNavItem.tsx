import type { AppView } from "../../../lib/router";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { SidebarItem } from "@argus/peacock";
import { parseRoute, pushRoute } from "../../../lib/router";

interface SidebarNavItemProps {
  children: ReactNode;
  count?: ReactNode;
  leading?: ReactNode;
  view: Exclude<AppView, "notifications" | "session">;
}

export function SidebarNavItem({
  view,
  leading,
  count,
  children,
}: SidebarNavItemProps) {
  const location = useLocation();
  const route = parseRoute(location.pathname);
  const active =
    route.view === view &&
    (view !== "organizations" || route.organizationId === null);

  return (
    <SidebarItem
      active={active}
      leading={leading}
      count={count}
      onClick={() => pushRoute({ view })}
    >
      {children}
    </SidebarItem>
  );
}
