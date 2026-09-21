import type { Meta, StoryObj } from "@storybook/react";
import { Breadcrumbs } from "./Breadcrumbs";

const meta: Meta<typeof Breadcrumbs> = {
  title: "Primitives/Breadcrumbs",
  component: Breadcrumbs,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Breadcrumbs>;

export const Root: Story = {
  args: {
    items: [
      { id: "app", label: "Argus" },
      { id: "view", label: "Automations" },
    ],
  },
};

export const Nested: Story = {
  args: {
    items: [
      { id: "app", label: "Argus", onClick: () => {} },
      { id: "view", label: "Automations", onClick: () => {} },
      { id: "item", label: "Standup digest" },
    ],
  },
};

export const Deep: Story = {
  args: {
    items: [
      { id: "app", label: "Argus", onClick: () => {} },
      { id: "view", label: "Automations", onClick: () => {} },
      { id: "item", label: "Standup digest", onClick: () => {} },
      { id: "run", label: "Sep 21, 09:00" },
    ],
  },
};

export const LongLabel: Story = {
  args: {
    items: [
      { id: "app", label: "Argus", onClick: () => {} },
      { id: "view", label: "Automations", onClick: () => {} },
      {
        id: "item",
        label:
          "Triage every crash report filed overnight and file the duplicates",
      },
    ],
  },
};
