import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  FolderIcon,
  GearIcon,
  HomeIcon,
  TerminalIcon,
} from "../../icons/Icons";
import { Input } from "../Input/Input";
import { Toggle } from "../Toggle/Toggle";
import {
  SettingsScreen,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  SettingsScreenField,
  SettingsScreenSection,
  SettingsScreenSectionGroup,
  SettingsScreenSidebar,
} from "./SettingsScreen";

const meta: Meta<typeof SettingsScreen> = {
  title: "Components/SettingsScreen",
  component: SettingsScreen,
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof SettingsScreen>;

const SECTIONS = [
  {
    id: "general",
    label: "General",
    icon: <GearIcon size={12} />,
    description: "Basic preferences",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: <HomeIcon size={12} />,
    description: "Theme & colours",
  },
  {
    id: "permissions",
    label: "Permissions",
    icon: <TerminalIcon size={12} />,
    description: "Default agent mode",
  },
  {
    id: "apps",
    label: "Open in apps",
    icon: <FolderIcon size={12} />,
    description: "Custom editors",
  },
];

export const Default: Story = {
  render: () => {
    const [active, setActive] = useState("appearance");

    return (
      <div style={{ height: "100vh", display: "flex" }}>
        <SettingsScreen>
          <SettingsScreenSidebar>
            <SettingsScreenSectionGroup label="App">
              {SECTIONS.map((s) => (
                <SettingsScreenSection
                  key={s.id}
                  active={active === s.id}
                  description={s.description}
                  icon={s.icon}
                  onClick={() => setActive(s.id)}
                >
                  {s.label}
                </SettingsScreenSection>
              ))}
            </SettingsScreenSectionGroup>
          </SettingsScreenSidebar>

          <SettingsScreenDetail>
            <SettingsScreenDetailHeader
              description="Choose how Argus looks. Match your system, or pin a theme."
              title="Appearance"
            />
            <SettingsScreenDetailBody>
              <SettingsScreenField
                caption="Used everywhere except the embedded editor."
                label="Theme"
              >
                <Toggle checked onChange={() => {}}>
                  Dark mode
                </Toggle>
              </SettingsScreenField>
              <SettingsScreenField
                caption="Override only if your system font is too small."
                label="UI density"
              >
                <Input placeholder="Comfortable" />
              </SettingsScreenField>
            </SettingsScreenDetailBody>
          </SettingsScreenDetail>
        </SettingsScreen>
      </div>
    );
  },
};
