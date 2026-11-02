/**
 * Settings as the Mac lays them out once there's room: the pages listed on
 * the left, the one in front on the right. Narrow windows keep the phone's
 * list, then one page at a time.
 */

import type { ReactNode } from "react";
import { AppSidebarNavItem, Icons } from "@argus/peacock";
import { appNavigate } from "../../routing/router";
import type { Screen, SettingsPage } from "../../routing/screens";
import { useConnectionStore } from "../../stores/connection";
import { useSettingsStore } from "../../stores/settings";
import { Settings, SettingsPageScreen } from "../Settings";
import { useIsDesktop } from "../useIsWide";
import { SETTINGS_PAGE_TITLES } from "./pages";

const BROWSER: [SettingsPage, ReactNode][] = [
  ["name", <Icons.PencilIcon key="name" size={14} />],
  ["appearance", <Icons.SlidersIcon key="appearance" size={14} />],
  ["alerts", <Icons.BellIcon key="alerts" size={15} />],
  ["privacy", <Icons.LockIcon key="privacy" size={14} />],
];

const COMPUTER: [SettingsPage, ReactNode][] = [
  ["connection", <Icons.LaptopIcon key="connection" size={14} />],
  ["agents", <Icons.AgentIcon key="agents" size={14} />],
  ["automations", <Icons.ClockIcon key="automations" size={14} />],
  ["claude-accounts", <Icons.OrganizationIcon key="accounts" size={14} />],
];

function NavGroup({
  current,
  label,
  pages,
  extra,
}: {
  current: SettingsPage;
  label: string;
  pages: [SettingsPage, ReactNode][];
  extra?: { label: string; icon: ReactNode; to: Screen }[];
}) {
  return (
    <div className="aw-settings-nav-group">
      <div className="aw-settings-nav-label">{label}</div>
      {pages.map(([page, icon]) => (
        <AppSidebarNavItem
          key={page}
          icon={icon}
          label={SETTINGS_PAGE_TITLES[page]}
          selected={page === current}
          onClick={() => appNavigate({ name: "settingsPage", page })}
        />
      ))}
      {extra?.map((e) => (
        <AppSidebarNavItem
          key={e.label}
          icon={e.icon}
          label={e.label}
          onClick={() => appNavigate(e.to)}
        />
      ))}
    </div>
  );
}

export function SettingsSplit({ page }: { page: SettingsPage | null }) {
  const isDesktop = useIsDesktop();
  const hostName = useConnectionStore((s) => s.identity?.account?.hostName);
  const hasDeviceHosts = useSettingsStore(
    (s) => (s.deviceHosts?.length ?? 0) > 0,
  );
  if (!isDesktop) {
    return page ? <SettingsPageScreen page={page} /> : <Settings />;
  }
  const current = page ?? "name";
  const computer: [SettingsPage, ReactNode][] = hasDeviceHosts
    ? [
        ...COMPUTER,
        ["device-hosts", <Icons.SimulatorIcon key="hosts" size={14} />],
      ]
    : COMPUTER;

  return (
    <div className="aw-settings-split">
      <nav aria-label="Settings" className="aw-settings-nav">
        <NavGroup
          current={current}
          extra={[
            {
              label: "Warnings & errors",
              icon: <Icons.WarningIcon size={14} />,
              to: { name: "notifications" },
            },
          ]}
          label="This browser"
          pages={BROWSER}
        />
        <NavGroup
          current={current}
          extra={[
            {
              label: "Usage",
              icon: <Icons.GaugeIcon size={14} />,
              to: { name: "usage", tab: "limits", range: "30d" },
            },
          ]}
          label={hostName ?? "This computer"}
          pages={computer}
        />
      </nav>
      <div className="aw-settings-detail">
        <SettingsPageScreen page={current} />
      </div>
    </div>
  );
}
