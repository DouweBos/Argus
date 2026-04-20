import type { ReactNode } from "react";
import { SidebarItem } from "@argus/peacock";
import { useLocation } from "react-router-dom";
import type { AppView } from "../../../lib/router";
import { parseRoute, pushRoute } from "../../../lib/router";

interface SidebarNavItemProps {
  view: Exclude<AppView, "session" | "notifications">;
  leading?: ReactNode;
  count?: ReactNode;
  children: ReactNode;
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
