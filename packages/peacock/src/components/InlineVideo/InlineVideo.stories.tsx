import type { Meta, StoryObj } from "@storybook/react";
import { InlineVideo } from "./InlineVideo";

const meta: Meta<typeof InlineVideo> = {
  title: "Components/InlineVideo",
  component: InlineVideo,
  decorators: [(Story) => <div style={{ maxWidth: 640 }}>{Story()}</div>],
};

export default meta;

type Story = StoryObj<typeof InlineVideo>;

export const Loading: Story = {
  args: { label: "Elgato Studio 2026-10-08.mov", src: null },
};

export const Failed: Story = {
  args: {
    label: "Elgato Studio 2026-10-08.mov",
    src: null,
    error: "couldn't download",
  },
};

export const Ready: Story = {
  args: {
    label: "Sample",
    src: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  },
};
