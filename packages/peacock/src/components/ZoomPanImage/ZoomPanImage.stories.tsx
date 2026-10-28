import type { Meta, StoryObj } from "@storybook/react";
import { ZoomPanImage } from "./ZoomPanImage";

// An 8x8 checker scaled up, so zooming and panning are visible.
const CHECKER =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAGUlEQVR4nGMwMHD4ukwZk2TAKgokGQalDgCxu0vBjvdEpQAAAABJRU5ErkJggg==";

const meta: Meta<typeof ZoomPanImage> = {
  title: "Components/ZoomPanImage",
  component: ZoomPanImage,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ display: "flex", height: 480 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof ZoomPanImage>;

/** A phone-sized frame: fitted on open, zoom with the controls or ⌘-scroll, drag to pan. */
export const PhoneFrame: Story = {
  args: { alt: "Frame", src: CHECKER, width: 390, height: 844 },
};

/** Smaller than the viewport — shown at 100%, centred. */
export const SmallImage: Story = {
  args: { alt: "Icon", src: CHECKER, width: 120, height: 120 },
};
