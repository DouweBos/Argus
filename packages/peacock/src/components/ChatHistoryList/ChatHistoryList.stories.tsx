import type {
  ChatHistoryEntry,
  ChatHistorySearchResult,
} from "@argus/remote-protocol";
import type { Meta, StoryObj } from "@storybook/react";
import { ChatHistoryList } from "./ChatHistoryList";

const NOW = Date.now();

const entry = (
  id: string,
  title: string,
  minutesAgo: number,
  extra: Partial<ChatHistoryEntry> = {},
): ChatHistoryEntry => ({
  id,
  title,
  sessionId: `runner-${id}`,
  sessionBranch: "feat/login-validation",
  sessionDescription: "",
  createdAt: NOW - minutesAgo * 60_000 - 600_000,
  endedAt: NOW - minutesAgo * 60_000,
  messageCount: 14,
  ...extra,
});

const entries = [
  entry("a", "Validate the login form on blur", 4, { pinned: true }),
  entry("b", "Fix the flaky signup test", 90),
  entry("c", "Explain the auth middleware", 60 * 30, {
    importedFrom: "claude_code",
  }),
];

const search = (query: string): Promise<ChatHistorySearchResult[]> =>
  new Promise((resolve) =>
    setTimeout(
      () =>
        resolve(
          entries
            .filter((e) => e.title.toLowerCase().includes(query.toLowerCase()))
            .map((e) => ({
              entry: e,
              metaMatch: true,
              messageMatches: [
                {
                  role: "user",
                  snippet: `…make sure ${query} works on every field…`,
                  matchStart: 12,
                  matchEnd: 12 + query.length,
                  messageIndex: 0,
                },
              ],
            })),
        ),
      300,
    ),
  );

const meta: Meta<typeof ChatHistoryList> = {
  title: "Components/ChatHistoryList",
  component: ChatHistoryList,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "A project's or session's saved chats: search across titles and messages, resume, pin (resumed when the computer restarts), delete. The client supplies `search`; leave it out and the field hides.",
      },
    },
  },
  args: {
    entries,
    title: "Chat history",
    meta: "3 in this session",
    search,
    onDelete: () => {},
    onResume: () => {},
    onSetPinned: () => {},
    onView: () => {},
    onClearAll: () => {},
  },
};

export default meta;

type Story = StoryObj<typeof ChatHistoryList>;

export const Default: Story = {};

export const WithoutSearch: Story = { args: { search: undefined } };

export const ReadOnly: Story = {
  args: { onSetPinned: undefined, onClearAll: undefined },
};
