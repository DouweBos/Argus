import type { Meta, StoryObj } from "@storybook/react";
import { ForkChatDialog } from "./ForkChatDialog";

const meta: Meta<typeof ForkChatDialog> = {
  title: "Components/ForkChatDialog",
  component: ForkChatDialog,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Fork a chat at a message: into a new session branched at that point, or into a new agent beside this one. The client says what the branch field resolves to; a rejected submit shows its reason and keeps the dialog open.",
      },
    },
  },
  args: {
    onClose: () => {},
    onSubmit: () => Promise.resolve(),
  },
};

export default meta;

type Story = StoryObj<typeof ForkChatDialog>;

export const Default: Story = {};

export const WithBranchPreview: Story = {
  args: {
    describeBranch: (branch, description) => {
      if (branch === "main") {
        return { hint: 'Branch "main" already exists.', blocked: true };
      }
      if (branch) {
        return {
          hint: (
            <>
              New branch: <strong>dana/{branch}</strong>
            </>
          ),
        };
      }

      return description
        ? { hint: "Branch name will be generated from your description." }
        : null;
    },
    branchFooter: <span>Personal prefix: dana/</span>,
  },
};

export const Fails: Story = {
  args: {
    onSubmit: () =>
      Promise.reject(new Error("The computer didn't answer in time.")),
  },
};
