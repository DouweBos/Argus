import type { Meta, StoryObj } from "@storybook/react";
import { DesignLayerList, type DesignLayerItem } from "./DesignLayerList";

const LAYERS: DesignLayerItem[] = [
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
    id: "1:2",
    name: "Header",
    type: "FRAME",
    depth: 1,
    width: 390,
    height: 96,
    text: null,
    fill: "#0f172a",
    font: null,
  },
  {
    id: "1:3",
    name: "Title",
    type: "TEXT",
    depth: 2,
    width: 220,
    height: 28,
    text: "Review your order",
    fill: "#f8fafc",
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
  {
    id: "1:5",
    name: "Label",
    type: "TEXT",
    depth: 2,
    width: 80,
    height: 20,
    text: "Pay now",
    fill: "#15151c",
    font: "Inter 600 16/20",
  },
  {
    id: "1:6",
    name: "Group",
    type: "GROUP",
    depth: 1,
    width: null,
    height: null,
    text: null,
    fill: null,
    font: null,
  },
];

const meta: Meta<typeof DesignLayerList> = {
  title: "Components/DesignLayerList",
  component: DesignLayerList,
  decorators: [
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof DesignLayerList>;

/** A frame's layers: indented by depth, with sizes, fills, fonts and text. */
export const Frame: Story = { args: { layers: LAYERS } };

/** A deep tree stops indenting past `maxIndent`. */
export const ShallowIndent: Story = { args: { layers: LAYERS, maxIndent: 1 } };

export const Empty: Story = { args: { layers: [] } };
