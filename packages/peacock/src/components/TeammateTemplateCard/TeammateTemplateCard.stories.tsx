import type { Meta, StoryObj } from "@storybook/react";
import {
  TeammateTemplateCard,
  TeammateTemplateGrid,
} from "./TeammateTemplateCard";

const meta: Meta<typeof TeammateTemplateCard> = {
  title: "Primitives/TeammateTemplateCard",
  component: TeammateTemplateCard,
  tags: ["autodocs"],
  args: {
    name: "CI Fixer",
    handle: "ci-fixer",
    tagline: "Keeps main green: reads failing checks and opens a fix.",
    color: "orange",
    avatar: { kind: "symbol", symbol: "wrench" },
    autonomy: "Draft",
    dutyNames: ["Fix failing checks", "Nightly flaky sweep"],
    needs: "GitHub",
    onPick: () => undefined,
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 320 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof TeammateTemplateCard>;

export const Default: Story = {};

export const NoRequirements: Story = {
  args: {
    name: "Standup Prep",
    handle: "standup",
    tagline: "Writes your standup from yesterday's work.",
    color: "blue",
    avatar: { kind: "symbol", symbol: "calendar" },
    autonomy: "Propose",
    dutyNames: ["Weekday standup notes"],
    needs: undefined,
  },
};

export const ReadOnly: Story = { args: { onPick: undefined } };

export const Gallery: Story = {
  decorators: [(Story) => <div style={{ maxWidth: 820 }}>{Story()}</div>],
  render: (args) => (
    <TeammateTemplateGrid>
      <TeammateTemplateCard {...args} />
      <TeammateTemplateCard
        {...args}
        avatar={{ kind: "symbol", symbol: "eye" }}
        color="purple"
        dutyNames={["Review new pull requests"]}
        handle="pr-reviewer"
        name="PR Reviewer"
        tagline="Reads every new pull request and leaves a first review."
      />
      <TeammateTemplateCard
        {...args}
        avatar={{ kind: "symbol", symbol: "tray" }}
        color="blue"
        dutyNames={["Triage new issues"]}
        handle="triager"
        name="Issue Triager"
        needs="Linear"
        tagline="Labels, sizes and routes new issues."
      />
    </TeammateTemplateGrid>
  ),
};
