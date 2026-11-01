import type { Meta, StoryObj } from "@storybook/react";
import { FIXTURE_DETAIL } from "../AutomationFields/fixtures";
import { DescribeAutomationView } from "./DescribeAutomationView";

const meta: Meta<typeof DescribeAutomationView> = {
  title: "Automations/DescribeAutomationView",
  component: DescribeAutomationView,
  tags: ["autodocs"],
  args: { onCreate: () => Promise.resolve() },
};
export default meta;
type Story = StoryObj<typeof DescribeAutomationView>;

export const Default: Story = {
  args: {
    onDraft: () =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              automation: { ...FIXTURE_DETAIL, id: "" },
              notes: [
                "Signal sources left empty: none matched the description.",
              ],
            }),
          700,
        ),
      ),
  },
};

export const DraftFails: Story = {
  args: {
    onDraft: () => Promise.reject(new Error("Not connected to a computer.")),
  },
};
