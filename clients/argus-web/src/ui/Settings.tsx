/**
 * Settings as a list of pages, grouped like the phone's: this browser, then
 * the computer it's connected to. Each page has its own URL.
 */

import { useEffect } from "react";
import {
  Icons,
  SettingsScreenSection,
  SettingsScreenSectionGroup,
} from "@argus/peacock";
import { useThemePreference } from "../lib/theme";
import { appNavigate } from "../routing/router";
import type { Screen, SettingsPage } from "../routing/screens";
import { useConnectionStore } from "../stores/connection";
import { useUnseenNotifications } from "../stores/notifications";
import { useSettingsStore } from "../stores/settings";
import { telemetryMode } from "../telemetry/telemetry";
import { accountFields } from "./accountFields";
import { AlertsPage, AppearancePage, NamePage, PrivacyPage } from "./settings/BrowserPages";
import { ClaudeAccountsPage } from "./settings/ClaudeAccountsPage";
import {
  AgentsPage,
  AutomationsPage,
  ConnectionPage,
  DeviceHostsPage,
} from "./settings/ComputerPages";
import { SETTINGS_PAGE_TITLES } from "./settings/pages";

const SCHEME_LABELS = { system: "System", light: "Light", dark: "Dark" };

function Row({
  icon,
  to,
  value,
  children,
}: {
  icon: React.ReactNode;
  to: Screen;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <SettingsScreenSection
      description={value}
      icon={icon}
      onClick={() => appNavigate(to)}
    >
      {children}
    </SettingsScreenSection>
  );
}

function PageRow({
  page,
  icon,
  value,
}: {
  page: SettingsPage;
  icon: React.ReactNode;
  value?: string;
}) {
  return (
    <Row icon={icon} to={{ name: "settingsPage", page }} value={value}>
      {SETTINGS_PAGE_TITLES[page]}
    </Row>
  );
}

export function Settings() {
  const deviceName = useConnectionStore((s) => s.deviceName);
  const account = useConnectionStore((s) => s.identity?.account);
  const connection = useConnectionStore((s) => s.connection);
  const scheme = useThemePreference();
  const unseen = useUnseenNotifications();
  const deviceHosts = useSettingsStore((s) => s.deviceHosts);
  const loadDeviceHosts = useSettingsStore((s) => s.loadDeviceHosts);
  const fields = accountFields();

  useEffect(() => {
    if (connection === "ready") {
      loadDeviceHosts({ background: true }).catch(() => {});
    }
  }, [connection, loadDeviceHosts]);

  return (
    <div className="aw-settings">
      <SettingsScreenSectionGroup label="This browser">
        <PageRow
          icon={<Icons.PencilIcon size={14} />}
          page="name"
          value={account ? undefined : deviceName}
        />
        <PageRow
          icon={<Icons.SlidersIcon size={14} />}
          page="appearance"
          value={SCHEME_LABELS[scheme]}
        />
        <PageRow icon={<Icons.ChatIcon size={14} />} page="alerts" />
        <PageRow
          icon={<Icons.LockIcon size={14} />}
          page="privacy"
          value={telemetryMode() === "full" ? "Sharing" : "Minimal"}
        />
        <Row
          icon={<Icons.WarningIcon size={14} />}
          to={{ name: "notifications" }}
          value={unseen > 0 ? `${String(unseen)} new` : undefined}
        >
          Warnings &amp; errors
        </Row>
      </SettingsScreenSectionGroup>

      <SettingsScreenSectionGroup label={account?.hostName ?? "This computer"}>
        <PageRow
          icon={<Icons.LaptopIcon size={14} />}
          page="connection"
          value={connection === "ready" ? "Connected" : "Not connected"}
        />
        <PageRow icon={<Icons.AgentIcon size={14} />} page="agents" />
        <PageRow icon={<Icons.ClockIcon size={14} />} page="automations" />
        <PageRow
          icon={<Icons.OrganizationIcon size={14} />}
          page="claude-accounts"
        />
        <Row
          icon={<Icons.GaugeIcon size={14} />}
          to={{ name: "usage", tab: "limits", range: "30d" }}
        >
          Usage
        </Row>
        {deviceHosts && deviceHosts.length > 0 && (
          <PageRow
            icon={<Icons.SimulatorIcon size={14} />}
            page="device-hosts"
            value={String(deviceHosts.length)}
          />
        )}
      </SettingsScreenSectionGroup>

      {account && fields && <fields.SignOut />}
    </div>
  );
}

/** `/settings/:page`. */
export function SettingsPageScreen({ page }: { page: SettingsPage }) {
  switch (page) {
    case "name":
      return <NamePage />;
    case "appearance":
      return <AppearancePage />;
    case "alerts":
      return <AlertsPage />;
    case "privacy":
      return <PrivacyPage />;
    case "connection":
      return <ConnectionPage />;
    case "agents":
      return <AgentsPage />;
    case "automations":
      return <AutomationsPage />;
    case "claude-accounts":
      return <ClaudeAccountsPage />;
    case "device-hosts":
      return <DeviceHostsPage />;
  }
}
