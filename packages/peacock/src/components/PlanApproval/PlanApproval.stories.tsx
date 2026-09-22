import type { Meta, StoryObj } from "@storybook/react";
import { PlanApproval } from "./PlanApproval";

const meta: Meta<typeof PlanApproval> = {
  title: "Agent/PlanApproval",
  component: PlanApproval,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof PlanApproval>;

export const Default: Story = {
  args: {
    plan: [
      "## Proposed plan",
      "",
      "1. Move `QuestionForm` and `PlanApproval` into Peacock.",
      "2. Wire the remote client to render permissions inline.",
      "3. Extend `permission.respond` with an optional message.",
      "",
      "```ts",
      "respond(agentId, toolUseId, 'deny', message);",
      "```",
    ].join("\n"),
    onApprove: () => alert("approve"),
    onReject: () => alert("keep planning"),
    onSubmitFeedback: (f) => alert(`feedback: ${f}`),
  },
};

export const WithNewSessionHandoff: Story = {
  args: {
    ...Default.args,
    onApproveInNewSession: () => alert("approve in new session"),
  },
};
