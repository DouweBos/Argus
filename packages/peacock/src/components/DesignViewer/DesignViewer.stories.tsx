import type { DesignViewerTab } from "./DesignSidePanel";
import type { FigmaFrameDetails } from "@argus/remote-protocol";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { DesignComparePane } from "../DesignComparePane/DesignComparePane";
import { DesignViewer, type DesignViewerMode } from "./DesignViewer";

// 1x1 PNGs, scaled to the frame size.
const RED_PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==";
const BLUE_PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const CURRENT = "https://www.figma.com/design/AbC/App?node-id=1-1";

const DETAILS: FigmaFrameDetails = {
  ref: {
    url: CURRENT,
    fileKey: "AbC",
    nodeId: "1:1",
    name: "Checkout",
    version: "101",
  },
  frame: { name: "Checkout", image: RED_PIXEL, width: 390, height: 844 },
  layers: [
    {
      id: "1:1",
      name: "Checkout",
      type: "FRAME",
      depth: 0,
      width: 390,
      height: 844,
      text: null,
      fill: "#ffffff",
      font: null,
    },
    {
      id: "1:3",
      name: "Title",
      type: "TEXT",
      depth: 1,
      width: 220,
      height: 28,
      text: "Review your order",
      fill: "#0f172a",
      font: "Inter 600 22/28",
    },
    {
      id: "1:4",
      name: "Pay button",
      type: "INSTANCE",
      depth: 1,
      width: 358,
      height: 52,
      text: null,
      fill: "#f5a623",
      font: null,
    },
  ],
  comments: [
    { author: "Mira", body: "Button should stick to the bottom safe area." },
    { author: "Jon", body: "Use the new price formatting here." },
  ],
  file: { name: "App", version: "101", lastModified: Date.UTC(2026, 2, 4) },
  pages: [
    {
      name: "Flows",
      frames: [
        {
          name: "Cart",
          url: "https://www.figma.com/design/AbC/App?node-id=1-0",
        },
        { name: "Checkout", url: CURRENT },
        {
          name: "Receipt",
          url: "https://www.figma.com/design/AbC/App?node-id=1-2",
        },
      ],
    },
    { name: "Archive", frames: [] },
  ],
};

const meta: Meta<typeof DesignViewer> = {
  title: "Components/DesignViewer",
  component: DesignViewer,
  parameters: { layout: "fullscreen" },
  args: {
    details: DETAILS,
    error: null,
    subtitle: "App · Edited Mar 4, 2026",
    tab: "layers",
    isCurrentFrame: (url) => url === CURRENT,
    onOpenFrame: () => {},
    onOpenInFigma: () => {},
    onTabChange: () => {},
  },
  render: function Render(args) {
    const [tab, setTab] = useState<DesignViewerTab>(args.tab);

    return (
      <div style={{ height: 640, display: "flex" }}>
        <DesignViewer {...args} tab={tab} onTabChange={setTab} />
      </div>
    );
  },
};

export default meta;
type Story = StoryObj<typeof DesignViewer>;

export const Loading: Story = { args: { details: null } };

export const Error: Story = {
  args: {
    details: null,
    error: "Connect Figma in Argus on your computer to open designs.",
  },
};

export const Layers: Story = {};

export const Comments: Story = { args: { tab: "comments" } };

export const Pages: Story = { args: { tab: "pages" } };

export const NoComments: Story = {
  args: { tab: "comments", details: { ...DETAILS, comments: [], layers: [] } },
};

/** Opened from a session whose captured version is older than the file. */
export const Changed: Story = { args: { changed: true } };

/** From a session: the frame/compare toggle, comparing against its device. */
export const Compare: Story = {
  render: function Render(args) {
    const [mode, setMode] = useState<DesignViewerMode>("compare");

    return (
      <div style={{ height: 640, display: "flex" }}>
        <DesignViewer
          {...args}
          compareLabel="Compare with simulator"
          mode={mode}
          onModeChange={setMode}
          compare={
            <DesignComparePane
              comparison={{
                differingFraction: 0.042,
                width: 390,
                height: 844,
                design: RED_PIXEL,
                screenshot: BLUE_PIXEL,
                diff: BLUE_PIXEL,
              }}
              deviceLabel="Simulator"
              differing="4.2%"
              error={null}
              hasDevice
              loading={false}
              onRetake={() => {}}
            />
          }
        />
      </div>
    );
  },
};
