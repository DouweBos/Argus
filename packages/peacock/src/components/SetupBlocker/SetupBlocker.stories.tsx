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
    title: "Argus needs cloudflared to hand out a share link",
    explanation:
      "A guest opens the link from outside your network, so Argus needs a way in that doesn't mean opening a port. It uses Cloudflare's free quick tunnel for that, which runs through the `cloudflared` command — and that command isn't installed on this Mac.",
    steps: [
      "Run the command below in a terminal.",
      "Quit and reopen Argus so it picks the command up.",
      "Come back here and start sharing.",
    ],
    command: "brew install cloudflared",
    alternative:
      "Already on Tailscale? Turn it on under Settings → Remote access and sharing uses your tailnet instead — no cloudflared needed.",
    actions: (
      <>
        <Button size="sm" variant="primary">
          Check again
        </Button>
        <Button size="sm" variant="secondary">
          Open Remote access
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
      "If it keeps failing, set up Tailscale or a named Cloudflare tunnel under Settings → Remote access.",
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

export const GuidedElsewhere: Story = {
  args: {
    title: "Tailscale isn't signed in",
    explanation:
      "Sharing goes out over your tailnet, which needs Tailscale installed, running, signed in, and allowed to use Funnel. This Mac isn't signed into a tailnet.",
    steps: [
      "Open Settings → Remote access — Argus checks each step there and can fix most of them for you.",
      "Once every check passes, come back and start sharing.",
    ],
    alternative:
      "Rather not use Tailscale? Install Cloudflare's tunnel instead with `brew install cloudflared` and restart Argus.",
    detail: "BackendState: NeedsLogin",
    actions: (
      <Button size="sm" variant="secondary">
        Open Remote access
      </Button>
    ),
  },
};
