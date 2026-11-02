import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
  BranchIcon,
  CodeIcon,
  FileIcon,
  HistoryIcon,
  LaptopIcon,
  PushIcon,
  SlidersIcon,
  SparklesIcon,
} from "../../icons/Icons";
import { StatusDot } from "../Badge/Badge";
import { DiffStat } from "../DiffStat/DiffStat";
import {
  ContextCard,
  ContextCardDivider,
  ContextCardRow,
  ContextCardSegments,
} from "./ContextCard";

const meta: Meta<typeof ContextCard> = {
  title: "Composites/ContextCard",
  component: ContextCard,
};
export default meta;
type Story = StoryObj<typeof ContextCard>;

type Panel = "agent" | "code" | "git";

function SessionCard({ startCollapsed = false }: { startCollapsed?: boolean }) {
  const [panel, setPanel] = useState<Panel>("agent");
  const [collapsed, setCollapsed] = useState(startCollapsed);

  return (
    <ContextCard collapsed={collapsed}>
      <ContextCardSegments<Panel>
        collapsed={collapsed}
        segments={[
          { id: "agent", title: "Agent", icon: <SparklesIcon size={12} /> },
          { id: "code", title: "Code", icon: <CodeIcon size={12} /> },
          { id: "git", title: "Git", icon: <BranchIcon size={12} /> },
        ]}
        selected={panel}
        onSelect={setPanel}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
      />
      {!collapsed && (
        <>
          <ContextCardDivider />
          <ContextCardRow
            icon={<LaptopIcon size={13} />}
            label="Douwe's MacBook Pro"
          />
          <ContextCardRow
            icon={<SlidersIcon size={12} />}
            label="MCP"
            trailing={
              <>
                <StatusDot tone="warning" />
                8/45
              </>
            }
          />
          <ContextCardDivider />
          <ContextCardRow icon={<BranchIcon size={12} />} label="main" />
          <ContextCardRow muted icon={<PushIcon size={12} />} label="Push" />
          <ContextCardRow
            icon={<FileIcon size={12} />}
            label="Changes"
            trailing={<DiffStat added={12} removed={3} />}
          />
          <ContextCardDivider />
          <ContextCardRow
            icon={<HistoryIcon size={12} />}
            label="Recent Chats"
            trailing="4"
          />
        </>
      )}
    </ContextCard>
  );
}

export const Session: Story = { render: () => <SessionCard /> };

export const Collapsed: Story = {
  render: () => <SessionCard startCollapsed />,
};
