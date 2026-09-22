import type { Meta, StoryObj } from "@storybook/react";
import { TypingIndicator } from "./TypingIndicator";

const meta: Meta<typeof TypingIndicator> = {
  title: "Components/TypingIndicator",
  component: TypingIndicator,
  parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof TypingIndicator>;

export const OnePerson: Story = {
  args: { names: ["Ana"] },
};

export const TwoPeople: Story = {
  args: { names: ["Ana", "Bo"] },
};

/** Past three the sentence stops growing, so a busy huddle stays one line. */
export const ACrowd: Story = {
  args: { names: ["Ana", "Bo", "Cai", "Dev", "Eli"] },
};

/** Wording for a row that already prints whose it is. */
export const OwnWording: Story = {
  args: { label: "Typing" },
};
