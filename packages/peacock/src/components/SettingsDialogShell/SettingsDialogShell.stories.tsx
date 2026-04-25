import type { Meta, StoryObj } from "@storybook/react";
import {
  FolderIcon,
  GearIcon,
  HomeIcon,
  TerminalIcon,
} from "../../icons/Icons";
import { Button } from "../Button/Button";
import {
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
} from "../SettingsScreen/SettingsScreen";
import { SettingsDialogShell } from "./SettingsDialogShell";

const meta: Meta<typeof SettingsDialogShell> = {
  title: "Components/SettingsDialogShell",
  component: SettingsDialogShell,
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof SettingsDialogShell>;

const placeholder = (label: string) => () => (
  <SettingsScreenDetail>
    <SettingsScreenDetailHeader
      description={`The body of the ${label} section goes here.`}
      title={label}
    />
    <SettingsScreenDetailBody>
      <p style={{ color: "var(--text-muted)", fontSize: 12 }}>
        Each section owns its own body — the shell only renders the chrome.
      </p>
    </SettingsScreenDetailBody>
  </SettingsScreenDetail>
);

export const AppSettings: Story = {
  render: () => (
    <SettingsDialogShell
      title="Settings"
      titleId="story-app-settings"
      onClose={() => {}}
      groups={[
        {
          sections: [
            {
              id: "appearance",
              label: "Appearance",
              description: "Theme",
              icon: <HomeIcon size={12} />,
              render: placeholder("Appearance"),
            },
            {
              id: "agents",
              label: "Agents",
              description: "Permissions",
              icon: <GearIcon size={12} />,
              render: placeholder("Agents"),
            },
            {
              id: "open-in",
              label: "Open in apps",
              description: "Custom editors",
              icon: <FolderIcon size={12} />,
              render: placeholder("Open in apps"),
            },
          ],
        },
      ]}
    />
  ),
};

export const ProjectSettingsWithFooter: Story = {
  render: () => (
    <SettingsDialogShell
      title="Project settings"
      titleId="story-project-settings"
      onClose={() => {}}
      footer={
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <Button variant="secondary">Cancel</Button>
          <Button variant="primary">Save .argus.json</Button>
        </div>
      }
      groups={[
        {
          label: "Workspace",
          sections: [
            {
              id: "setup",
              label: "Setup",
              description: "Copy, symlink, commands",
              icon: <FolderIcon size={12} />,
              render: placeholder("Session setup"),
            },
            {
              id: "terminals",
              label: "Terminals",
              description: "Auto-opened tabs",
              icon: <TerminalIcon size={12} />,
              render: placeholder("Terminals"),
            },
          ],
        },
        {
          label: "Workflow",
          sections: [
            {
              id: "agent",
              label: "Agent",
              description: "Prompt & history",
              icon: <GearIcon size={12} />,
              render: placeholder("Agent"),
            },
          ],
        },
      ]}
    />
  ),
};
