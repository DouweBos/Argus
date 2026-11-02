import type { Meta, StoryObj } from "@storybook/react";
import { StatusDot } from "../Badge/Badge";
import { Button } from "../Button/Button";
import { Input } from "../Input/Input";
import { Toggle } from "../Toggle/Toggle";
import {
  SettingsGroup,
  SettingsPageColumn,
  SettingsRow,
} from "./SettingsGroup";

const meta: Meta<typeof SettingsGroup> = {
  title: "Composites/SettingsGroup",
  component: SettingsGroup,
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof SettingsGroup>;

export const Page: Story = {
  render: () => (
    <SettingsPageColumn>
      <SettingsGroup title="This browser">
        <SettingsRow
          control={<Input defaultValue="Mac browser" />}
          description="How Argus on the computer lists this browser."
          title="Name"
        />
        <SettingsRow
          control={<Toggle checked onChange={() => {}} />}
          description="A notification when an agent needs you."
          title="Alerts"
        />
      </SettingsGroup>
      <SettingsGroup
        footer="Change what this browser may do in Argus on the computer."
        title="Connection"
      >
        <SettingsRow
          control={
            <>
              <StatusDot tone="success" />
              Connected
            </>
          }
          title="Status"
        />
        <SettingsRow control="Watch and control agents" title="Access" />
        <SettingsRow
          control={
            <Button size="sm" variant="danger">
              Unpair…
            </Button>
          }
          description="Removes the stored key from this browser."
          title="Unpair this browser"
        />
      </SettingsGroup>
    </SettingsPageColumn>
  ),
};
