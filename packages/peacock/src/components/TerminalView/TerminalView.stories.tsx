import type { Meta, StoryObj } from "@storybook/react";
import {
  type TerminalChunk,
  type TerminalStream,
  TerminalView,
} from "./TerminalView";

const meta: Meta<typeof TerminalView> = {
  title: "Components/TerminalView",
  component: TerminalView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ height: 320, display: "flex", flexDirection: "column" }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof TerminalView>;

const HISTORY = [
  "\x1b[1m$ pnpm dev\x1b[0m\r\n",
  "\x1b[32m  VITE v7.0.4\x1b[0m  ready in \x1b[1m312 ms\x1b[0m\r\n\r\n",
  "  \x1b[32m➜\x1b[0m  \x1b[1mLocal\x1b[0m:   \x1b[36mhttp://localhost:5173/\x1b[0m\r\n",
  "  \x1b[2m➜  press h + enter to show help\x1b[0m\r\n",
];

/** Replays the history, then prints a line every second. */
function fakeStream(live: boolean, exitCode?: number): TerminalStream {
  return {
    subscribe(sink) {
      const first: TerminalChunk[] = [
        { kind: "reset" },
        ...HISTORY.map((data) => ({ kind: "data" as const, data })),
      ];
      if (exitCode !== undefined) {
        first.push({ kind: "exit", code: exitCode });
      }
      sink(first);
      if (!live) {
        return () => {};
      }
      let n = 0;
      const id = setInterval(() => {
        n += 1;
        sink([
          {
            kind: "data",
            data: `\x1b[2m${new Date().toLocaleTimeString()}\x1b[0m [vite] page reload \x1b[33msrc/App.tsx\x1b[0m (x${n})\r\n`,
          },
        ]);
      }, 1000);

      return () => clearInterval(id);
    },
  };
}

export const ReadOnlyLive: Story = {
  args: { stream: fakeStream(true), readOnly: true },
};

export const Exited: Story = {
  args: { stream: fakeStream(false, 1), readOnly: true },
};

export const Interactive: Story = {
  args: { stream: fakeStream(false), readOnly: false },
};
