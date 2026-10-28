import type { Meta, StoryObj } from "@storybook/react";
import { Markdown } from "./Markdown";

const meta: Meta<typeof Markdown> = {
  title: "Chat/Markdown",
  component: Markdown,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Markdown>;

export const Prose: Story = {
  args: {
    text: [
      "# Heading",
      "Some **bold** and _italic_ text with `inline code` and a [link](https://example.com).",
      "- item one\n- item two",
      "```ts\nconst x = 1;\n```",
      "> a blockquote",
      "| a | b |\n| - | - |\n| 1 | 2 |",
    ].join("\n\n"),
  },
};

export const TaskList: Story = {
  args: {
    text: "- [x] done\n- [ ] not done",
  },
};

/** `onLinkClick` claims some links for the app; the rest open as usual. */
export const InterceptedLinks: Story = {
  args: {
    text: "See the [checkout frame](https://www.figma.com/design/abc/App?node-id=1-2) and the [docs](https://example.com).",
    onLinkClick: (url: string) => url.includes("figma.com"),
  },
};
