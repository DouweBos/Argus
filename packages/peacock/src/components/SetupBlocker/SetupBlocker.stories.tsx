import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../Button/Button";
import { SetupBlocker } from "./SetupBlocker";

const meta: Meta<typeof SetupBlocker> = {
  title: "Components/SetupBlocker",
  component: SetupBlocker,
  parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof SetupBlocker>;

export const MissingCommand: Story = {
  args: {
    title: "Argus couldn't set up cloudflared to hand out a share link",
    explanation:
      "A guest opens the link from outside your network, so Argus needs a way in that doesn't mean opening a port. It uses Cloudflare's free quick tunnel for that, through the `cloudflared` command, which Argus downloads the first time it's needed — and that download didn't work.",
    steps: [
      "Check this computer's internet connection.",
      "Try sharing again.",
      "Still stuck? Install it yourself with the command below and restart Argus.",
    ],
    command: "brew install cloudflared",
    alternative:
      "Sign in to an account under Settings → Account and this computer gets a tunnel of its own, which sharing uses instead.",
    actions: (
      <>
        <Button size="sm" variant="primary">
          Check again
        </Button>
        <Button size="sm" variant="secondary">
          Open Account
        </Button>
      </>
    ),
  },
};

export const TransientFailure: Story = {
  args: {
    tone: "warning",
    title: "Couldn't get a public link",
    explanation:
      "Cloudflare hands out its free quick tunnels on a best-effort basis — it rate-limits them and rotates them out, so one can fail to come up even though nothing is wrong on this Mac.",
    steps: [
      "Wait a minute, then try again.",
      "If it keeps failing, sign in to an account under Settings → Account: this computer then gets a tunnel of its own that doesn't depend on quick tunnels.",
    ],
    detail:
      "cloudflared: failed to request quick tunnel: 429 Too Many Requests\ncloudflared exited (1)",
    actions: (
      <Button size="sm" variant="primary">
        Try again
      </Button>
    ),
  },
};
