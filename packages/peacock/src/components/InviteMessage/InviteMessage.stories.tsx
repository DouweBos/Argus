import type { Meta, StoryObj } from "@storybook/react";
import { InviteMessage } from "./InviteMessage";

const meta: Meta<typeof InviteMessage> = {
  title: "Components/InviteMessage",
  component: InviteMessage,
  parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof InviteMessage>;

const URL = "https://polite-otter-42.trycloudflare.com/#/huddle/8Kq2-xh";

export const Default: Story = {
  args: {
    message: `Ana wants you to join “Fix the login flow” in Argus — ${URL}`,
    link: URL,
  },
};

/** A long title wraps rather than hiding the link behind an ellipsis. */
export const LongTitle: Story = {
  args: {
    message: `Ana wants you to join “Work out why the onboarding carousel drops a frame on the second slide” in Argus — ${URL}`,
    link: URL,
  },
};

/** Before the tunnel hands back a URL there is nothing to copy yet. */
export const StillComingUp: Story = {
  args: { message: "", placeholder: "Getting a link…" },
};
