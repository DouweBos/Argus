import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { FilterChip } from "./FilterChip";

const meta: Meta<typeof FilterChip> = {
  title: "Components/FilterChip",
  component: FilterChip,
};

export default meta;

type Story = StoryObj<typeof FilterChip>;

export const Toggleable: Story = {
  render: () => {
    const [negate, setNegate] = useState(false);

    return (
      <FilterChip
        field="Cycle"
        operator={negate ? "is not" : "is"}
        value="Current cycle"
        onOperatorClick={() => setNegate((n) => !n)}
        onRemove={() => {}}
      />
    );
  },
};

export const ManyValues: Story = {
  args: {
    field: "Labels",
    operator: "include any of",
    value: "Bug, Casting, iOS",
    onRemove: () => {},
  },
};

export const Text: Story = {
  args: {
    field: "Content",
    operator: "contains",
    value: "casting",
    onRemove: () => {},
  },
};
