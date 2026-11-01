import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { FileIcon, FolderIcon } from "../../icons/Icons";
import { Badge } from "../Badge/Badge";
import { type PaletteGroup, PaletteDialog } from "./PaletteDialog";

const meta: Meta<typeof PaletteDialog> = {
  title: "Components/PaletteDialog",
  component: PaletteDialog,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof PaletteDialog>;

const FILES: PaletteGroup[] = [
  {
    key: "files",
    items: [
      {
        id: "a",
        icon: <FileIcon size={13} />,
        title: "useTerminal.ts",
        titleMatches: [3, 4, 5, 6],
        sublabel: "app/hooks",
        badge: <Badge>changed</Badge>,
      },
      {
        id: "b",
        icon: <FileIcon size={13} />,
        title: "TerminalTabs.tsx",
        titleMatches: [0, 1, 2, 3],
        sublabel: "app/components/runtime/Terminal",
      },
      {
        id: "c",
        icon: <FileIcon size={13} />,
        title: "multiplexer.ts",
        sublabel: "packages/host/src/services/terminal",
        sublabelMatches: [27, 28, 29, 30],
      },
    ],
  },
];

function Interactive({ groups }: { groups: PaletteGroup[] }) {
  const [query, setQuery] = useState("term");

  return (
    <PaletteDialog
      ariaLabel="Open a file"
      groups={groups}
      placeholder="Search files by name…"
      query={query}
      onClose={() => {}}
      onQueryChange={setQuery}
      onSelect={() => {}}
    />
  );
}

export const QuickOpen: Story = {
  render: () => <Interactive groups={FILES} />,
};

export const Grouped: Story = {
  render: () => (
    <Interactive
      groups={[
        {
          key: "projects",
          label: "Open projects",
          items: [
            {
              id: "p1",
              icon: <FolderIcon size={13} />,
              title: "Argus",
              sublabel: "~/Work/Argus",
            },
          ],
        },
        {
          key: "sessions",
          label: "Sessions",
          items: [
            {
              id: "s1",
              icon: <FolderIcon size={13} />,
              title: "feat/web-files",
              sublabel: "Argus · current",
              hint: ["⌘", "1"],
            },
          ],
        },
      ]}
    />
  ),
};

export const Loading: Story = {
  args: {
    ariaLabel: "Open a file",
    groups: [],
    loading: true,
    placeholder: "Search files by name…",
    query: "",
  },
};

export const NoMatches: Story = {
  args: {
    ariaLabel: "Open a file",
    emptyLabel: "No file matches “zzz”.",
    groups: [],
    placeholder: "Search files by name…",
    query: "zzz",
  },
};
