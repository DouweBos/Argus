import type { Meta, StoryObj } from "@storybook/react";
import { GridScreen } from "./GridScreen";

const meta: Meta<typeof GridScreen> = {
  title: "Components/GridScreen",
  component: GridScreen,
  parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof GridScreen>;

function Card({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        background: "var(--glass-bg)",
        border: "1px solid var(--glass-border)",
        borderRadius: "var(--border-radius)",
        fontSize: 13,
        color: "var(--text-primary)",
      }}
    >
      {label}
    </div>
  );
}

export const FlatList: Story = {
  render: () => (
    <GridScreen>
      <GridScreen.Header
        title="Organizations"
        subtitle="4 organizations · 2 running tasks"
      />
      <GridScreen.Grid>
        <Card label="Argus OS" />
        <Card label="Peacock" />
        <Card label="Conductor" />
        <Card label="Houwert.dev" />
      </GridScreen.Grid>
    </GridScreen>
  ),
};

export const SectionedList: Story = {
  render: () => (
    <GridScreen>
      <GridScreen.Header
        title="Pull requests"
        subtitle="6 open · authored, reviewing, or commented"
      />
      <GridScreen.Section title="argus-dev/argus" count={3}>
        <GridScreen.Grid>
          <Card label="PR #124 · Responsive layout" />
          <Card label="PR #119 · Graph UX polish" />
          <Card label="PR #117 · Fix flake" />
        </GridScreen.Grid>
      </GridScreen.Section>
      <GridScreen.Section title="houwert/conductor" count={3}>
        <GridScreen.Grid>
          <Card label="PR #42 · Android capture fix" />
          <Card label="PR #39 · Web shim idle timeout" />
          <Card label="PR #37 · Device pool refactor" />
        </GridScreen.Grid>
      </GridScreen.Section>
    </GridScreen>
  ),
};
