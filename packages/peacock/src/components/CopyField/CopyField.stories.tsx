import type { Meta, StoryObj } from "@storybook/react";
import { CopyField } from "./CopyField";

const meta: Meta<typeof CopyField> = {
  title: "Components/CopyField",
  component: CopyField,
  parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof CopyField>;

export const ShareLink: Story = {
  args: {
    value: "https://gentle-ridge-4821.trycloudflare.com/#/huddle/7fQ2k",
    copyLabel: "Copy huddle link",
  },
};

export const Long: Story = {
  args: {
    value:
      "https://gentle-ridge-4821.trycloudflare.com/#/huddle/7fQ2kR1sVbN9pLx3ZtA0mYh8dCeG5uJwQoI6",
  },
};

/** No link yet — the tunnel is still coming up, so there is nothing to copy. */
export const Pending: Story = {
  args: { value: "", placeholder: "Getting a link…" },
};
