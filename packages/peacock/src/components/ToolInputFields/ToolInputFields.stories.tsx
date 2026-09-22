import type { Meta, StoryObj } from "@storybook/react";
import { ToolInputFields } from "./ToolInputFields";
import { toolInputFields } from "./fields";

const meta: Meta<typeof ToolInputFields> = {
  title: "Components/ToolInputFields",
  component: ToolInputFields,
  parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof ToolInputFields>;

/** The common case: a couple of short parameters. */
export const Simple: Story = {
  args: {
    fields: toolInputFields({
      file_path: "/Users/ana/code/app/src/main.ts",
      limit: 200,
    }),
  },
};

/** Nested objects and arrays flatten into paths — no braces anywhere. */
export const Nested: Story = {
  args: {
    fields: toolInputFields({
      edits: [
        { old_string: "const a = 1", new_string: "const a = 2" },
        { old_string: "return a", new_string: "return a + 1" },
      ],
      replace_all: false,
    }),
  },
};

/** A long or multi-line value gets its own block under the label. */
export const LongValues: Story = {
  args: {
    fields: toolInputFields({
      prompt:
        "Review the changed files for correctness bugs.\nReport each finding with a failure scenario.",
      max_results: 5,
    }),
  },
};

/** Nothing to descend into reads as "none", never as `[]` or `{}`. */
export const EmptyContainers: Story = {
  args: {
    fields: toolInputFields({ paths: [], options: {}, dry_run: true }),
  },
};

/** A tool called with no parameters at all. */
export const NoInput: Story = { args: { fields: [] } };
