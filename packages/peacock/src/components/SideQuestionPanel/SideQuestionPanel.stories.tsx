import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Markdown } from "../Markdown/Markdown";
import { SideQuestionPanel, type SideQuestionItem } from "./SideQuestionPanel";

const meta: Meta<typeof SideQuestionPanel> = {
  title: "Chat/SideQuestionPanel",
  component: SideQuestionPanel,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof SideQuestionPanel>;

const noop = () => {};
const renderMarkdown = (text: string, className?: string) => (
  <Markdown className={className} text={text} />
);

const ITEMS: SideQuestionItem[] = [
  {
    id: "1",
    question: "Which file holds the retry logic?",
    answer:
      "It lives in `src/net/retry.ts` — `withBackoff()` wraps every request.",
    pending: false,
    sent: true,
  },
  {
    id: "2",
    question: "Are you touching the tests?",
    answer: "Yes:\n\n- `retry.test.ts`\n- `client.test.ts`",
    pending: false,
  },
  {
    id: "3",
    question: "Why did the build fail earlier?",
    error: "The agent has no conversation yet.",
    pending: false,
  },
  { id: "4", question: "How far along are you?", pending: true },
];

export const Empty: Story = {
  args: { items: [], onAsk: noop, onSend: noop },
};

export const Exchanges: Story = {
  args: {
    items: ITEMS,
    onAsk: noop,
    onSend: noop,
    onClear: noop,
    renderMarkdown,
  },
};

function Interactive() {
  const [items, setItems] = useState<SideQuestionItem[]>([]);

  return (
    <SideQuestionPanel
      items={items}
      renderMarkdown={renderMarkdown}
      onAsk={(question) =>
        setItems((prev) => [
          ...prev,
          {
            id: String(prev.length),
            question,
            answer: `You asked **${question}**.`,
            pending: false,
          },
        ])
      }
      onClear={() => setItems([])}
      onSend={(id) =>
        setItems((prev) =>
          prev.map((i) => (i.id === id ? { ...i, sent: true } : i)),
        )
      }
    />
  );
}

export const Playground: Story = { render: () => <Interactive /> };
