import type { ToolResultBlockData } from "./helpers";
import type { Meta, StoryObj } from "@storybook/react";
import { ToolCall } from "./ToolCall";

const meta: Meta<typeof ToolCall> = {
  title: "Chat/ToolCall",
  component: ToolCall,
  tags: ["autodocs"],
  args: {
    resolveImageSrc: (block) => block.data,
  },
};
export default meta;
type Story = StoryObj<typeof ToolCall>;

export const Bash: Story = {
  args: {
    toolCall: {
      id: "1",
      name: "Bash",
      input: { command: "pnpm build" },
      result: "Build succeeded in 4.2s",
    },
  },
};

export const Edit: Story = {
  args: {
    toolCall: {
      id: "2",
      name: "Edit",
      input: {
        file_path: "/src/app.ts",
        old_string: "const port = 3000;",
        new_string: "const port = 8080;",
      },
      result: "ok",
    },
  },
};

const IMAGE: ToolResultBlockData = {
  type: "image",
  mediaType: "image/svg+xml",
  data:
    "data:image/svg+xml;base64," +
    btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#059669"/></svg>',
    ),
};

export const ReadImage: Story = {
  args: {
    toolCall: {
      id: "3",
      name: "Read",
      input: { file_path: "/shot.png" },
      result: [{ type: "text", text: "Read image" }, IMAGE],
    },
  },
};

export const TaskWithChildren: Story = {
  args: {
    toolCall: {
      id: "4",
      name: "Task",
      input: { description: "investigate the bug" },
      children: [
        { kind: "text", text: "Looking into it…" },
        {
          kind: "tool_use",
          toolCall: {
            id: "4a",
            name: "Grep",
            input: { pattern: "TODO" },
            result: "3 hits",
          },
        },
      ],
    },
  },
};

export const AwaitingPermission: Story = {
  args: {
    toolCall: {
      id: "5",
      name: "Bash",
      input: { command: "rm -rf build" },
      pendingPermission: true,
    },
  },
};

const BACKGROUND_CHILDREN = [
  {
    kind: "tool_use" as const,
    toolCall: {
      id: "bg-c1",
      name: "Bash",
      input: { command: "pnpm vitest run" },
      result: "ok",
    },
  },
];

export const BackgroundAgentRunning: Story = {
  args: {
    toolCall: {
      id: "bg1",
      name: "Agent",
      input: {
        description: "Mac new-agent composer QoL",
        subagent_type: "general-purpose",
        run_in_background: true,
      },
      result: "Async agent launched successfully.",
      background: { status: "running", startedAt: Date.now() - 252_000 },
      children: BACKGROUND_CHILDREN,
    },
  },
};

export const BackgroundAgentDone: Story = {
  args: {
    toolCall: {
      id: "bg2",
      name: "Agent",
      input: {
        description: "Mac new-agent composer QoL",
        subagent_type: "general-purpose",
        run_in_background: true,
      },
      result: "Async agent launched successfully.",
      background: {
        status: "completed",
        startedAt: Date.now() - 1_121_000,
        durationMs: 1_121_000,
      },
      children: BACKGROUND_CHILDREN,
    },
  },
};

export const BackgroundBashFailed: Story = {
  args: {
    toolCall: {
      id: "bg3",
      name: "Bash",
      input: { command: "pnpm lint", run_in_background: true },
      result: "Command running in background with ID: b5vmmc4ng.",
      background: {
        status: "failed",
        startedAt: Date.now(),
        durationMs: 41_000,
      },
    },
  },
};
