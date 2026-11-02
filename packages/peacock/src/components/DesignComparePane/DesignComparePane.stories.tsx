import type { DesignComparison } from "@argus/remote-protocol";
import type { Meta, StoryObj } from "@storybook/react";
import { Badge } from "../Badge/Badge";
import { DesignComparePane } from "./DesignComparePane";

// 1x1 PNGs, scaled to the frame size.
const RED_PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==";
const BLUE_PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const GREEN_PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const COMPARISON: DesignComparison = {
  differingFraction: 0.042,
  width: 390,
  height: 844,
  design: RED_PIXEL,
  screenshot: BLUE_PIXEL,
  diff: GREEN_PIXEL,
};

const meta: Meta<typeof DesignComparePane> = {
  title: "Components/DesignComparePane",
  component: DesignComparePane,
  parameters: { layout: "fullscreen" },
  args: {
    comparison: null,
    deviceLabel: "Simulator",
    differing: null,
    error: null,
    hasDevice: true,
    loading: false,
    onRetake: () => {},
  },
  render: (args) => (
    <div style={{ height: 560, display: "flex" }}>
      <DesignComparePane {...args} />
    </div>
  ),
};

export default meta;
type Story = StoryObj<typeof DesignComparePane>;

export const Loading: Story = { args: { loading: true } };

export const Differs: Story = {
  args: { comparison: COMPARISON, differing: "4.2%" },
};

export const Matches: Story = {
  args: {
    comparison: { ...COMPARISON, differingFraction: 0.004 },
    differing: "0.4%",
  },
};

/** A component frame the host couldn't find on the device's screen. */
export const NotOnScreen: Story = {
  args: {
    comparison: {
      ...COMPARISON,
      match: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        scale: 3,
        confidence: 0.1,
        found: false,
        component: true,
      },
    },
    differing: "61%",
  },
};

export const NoDevice: Story = { args: { hasDevice: false } };

export const Error: Story = {
  args: { error: "The simulator didn't return a screenshot." },
};

/** Toolbar slots, e.g. a frame picker before and an action after. */
export const WithToolbarSlots: Story = {
  args: {
    comparison: COMPARISON,
    differing: "4.2%",
    deviceLabel: "Emulator",
    leading: <Badge size="tag">Checkout</Badge>,
    trailing: <Badge size="tag">Pixel 9</Badge>,
  },
};
