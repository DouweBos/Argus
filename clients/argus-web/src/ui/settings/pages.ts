/** What each settings page is called, as the phone's `SettingsPage`. */

import type { SettingsPage } from "../../routing/screens";

export const SETTINGS_PAGE_TITLES: Record<SettingsPage, string> = {
  name: "Name",
  appearance: "Appearance",
  alerts: "Alerts",
  privacy: "Privacy",
  connection: "Connection",
  agents: "Agents",
  automations: "Automations",
  "claude-accounts": "Claude Accounts",
  "device-hosts": "Device Hosts",
};
