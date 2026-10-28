import type { Meta, StoryObj } from "@storybook/react";
import { ImageDiff } from "./ImageDiff";

// Small synthetic data-URL images for story fixtures.
// 1x1 solid-color PNGs encoded as base64, scaled via CSS.
const RED_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==";
const BLUE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const GREEN_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
// A slightly transparent PNG for the alpha story (4x4 checkerboard-ish)
const ALPHA_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAH0lEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==";

const meta: Meta<typeof ImageDiff> = {
  title: "Components/ImageDiff",
  component: ImageDiff,
  parameters: {
    layout: "padded",
    backgrounds: { default: "dark" },
  },
};

export default meta;
type Story = StoryObj<typeof ImageDiff>;

/** Modified image — same size, slider + side-by-side toggle available. */
export const Modified: Story = {
  args: {
    before: RED_PNG,
    after: BLUE_PNG,
    beforeMeta: { width: 800, height: 600, bytes: 12345 },
    afterMeta: { width: 800, height: 600, bytes: 9876 },
  },
};

/** Different-size images (aspect ratios differ). */
export const DifferentSizes: Story = {
  args: {
    before: RED_PNG,
    after: GREEN_PNG,
    beforeMeta: { width: 1920, height: 1080, bytes: 204800 },
    afterMeta: { width: 400, height: 300, bytes: 51200 },
  },
};

/** Newly added image — no before. */
export const Added: Story = {
  args: {
    after: GREEN_PNG,
    afterMeta: { width: 512, height: 512, bytes: 4096 },
  },
};

/** Deleted image — no after. */
export const Deleted: Story = {
  args: {
    before: RED_PNG,
    beforeMeta: { width: 256, height: 256, bytes: 1024 },
  },
};

/** Image with heavy alpha channel — checkerboard shines through. */
export const HeavyAlpha: Story = {
  args: {
    before: RED_PNG,
    after: ALPHA_PNG,
    afterMeta: { width: 4, height: 4, bytes: 68 },
  },
};

/** No metadata captions — minimal mode. */
export const NoCaptions: Story = {
  args: {
    before: RED_PNG,
    after: BLUE_PNG,
  },
};

/** Custom pane labels — e.g. a design frame against the running app. */
export const CustomLabels: Story = {
  args: {
    before: BLUE_PNG,
    after: GREEN_PNG,
    beforeLabel: "Design",
    afterLabel: "Simulator",
  },
};

/** With a heatmap of where the two differ — adds a Diff mode. */
export const WithHeatmap: Story = {
  args: {
    before: RED_PNG,
    after: BLUE_PNG,
    diff: GREEN_PNG,
    beforeLabel: "Design",
    afterLabel: "Simulator",
  },
};
