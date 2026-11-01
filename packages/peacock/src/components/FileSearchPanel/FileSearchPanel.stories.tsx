import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Banner } from "../Banner/Banner";
import {
  type FileSearchFileGroup,
  type FileSearchOptions,
  FileSearchPanel,
  type FileSearchStatus,
} from "./FileSearchPanel";

const meta: Meta<typeof FileSearchPanel> = {
  title: "Components/FileSearchPanel",
  component: FileSearchPanel,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof FileSearchPanel>;

const GROUPS: FileSearchFileGroup[] = [
  {
    path: "app/hooks/useTerminal.ts",
    hits: [
      {
        key: "1",
        line: 118,
        before: "export function ",
        match: "useTerminal",
        after: "({",
      },
      {
        key: "2",
        line: 420,
        before: "  // ",
        match: "useTerminal",
        after: " owns the xterm instance",
      },
    ],
  },
  {
    path: "app/components/runtime/Terminal/ShellTerminal.tsx",
    hits: [
      {
        key: "3",
        line: 2,
        before: "import { ",
        match: "useTerminal",
        after: ' } from "../../../hooks/useTerminal";',
      },
    ],
  },
];

function Interactive({
  status,
  groups,
}: {
  status: FileSearchStatus;
  groups: FileSearchFileGroup[];
}) {
  const [query, setQuery] = useState("useTerminal");
  const [options, setOptions] = useState<FileSearchOptions>({
    regex: false,
    caseSensitive: true,
    wholeWord: false,
  });

  return (
    <FileSearchPanel
      groups={groups}
      options={options}
      query={query}
      status={status}
      onOpenHit={() => {}}
      onOptionsChange={setOptions}
      onQueryChange={setQuery}
    />
  );
}

export const Results: Story = {
  render: () => (
    <Interactive
      groups={GROUPS}
      status={{ kind: "done", count: 3, truncated: false }}
    />
  ),
};

export const Streaming: Story = {
  render: () => (
    <Interactive groups={GROUPS.slice(0, 1)} status={{ kind: "running" }} />
  ),
};

export const Truncated: Story = {
  render: () => (
    <Interactive
      groups={GROUPS}
      status={{ kind: "done", count: 2000, truncated: true }}
    />
  ),
};

export const NoResults: Story = {
  render: () => (
    <Interactive
      groups={[]}
      status={{ kind: "done", count: 0, truncated: false }}
    />
  ),
};

export const InvalidRegex: Story = {
  render: () => (
    <Interactive
      groups={[]}
      status={{ kind: "failed", message: "regex parse error: unclosed group" }}
    />
  ),
};

export const Disabled: Story = {
  args: {
    disabled: true,
    groups: [],
    notice: (
      <Banner tone="warning">Searching files needs control access.</Banner>
    ),
    options: { regex: false, caseSensitive: false, wholeWord: false },
    query: "",
    status: { kind: "idle" },
  },
};
