import type { Meta, StoryObj } from "@storybook/react";
import { SparkleIcon } from "../../icons/HomeIcons";
import { FolderIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { Kbd } from "../Kbd/Kbd";
import { TipCard } from "../TipCard/TipCard";
import { EmptyHome } from "./EmptyHome";

const meta: Meta<typeof EmptyHome> = {
  title: "Composites/EmptyHome",
  component: EmptyHome,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof EmptyHome>;

export const Default: Story = {
  render: () => (
    <div
      style={{
        minHeight: 720,
        width: "100%",
        background: "var(--bg-primary)",
      }}
    >
      <EmptyHome
        actions={
          <>
            <Button variant="primary" leading={<FolderIcon size={13} />}>
              Add repository
            </Button>
            <Button variant="ghost" leading={<SparkleIcon size={13} />}>
              Try the tour
            </Button>
          </>
        }
        tips={
          <>
            <TipCard
              icon={<SparkleIcon size={11} />}
              title="Spin up parallel ideas"
              body="Every workspace is an isolated git worktree. Run five attempts side-by-side — none step on each other."
            />
            <TipCard
              icon={<SparkleIcon size={11} />}
              title="Approve only what you need"
              body="The permission broker lets you allow a single tool call, or always-allow a pattern."
            />
            <TipCard
              icon={<SparkleIcon size={11} />}
              title="Drive simulators from the agent"
              body="Agents tap, scroll, and type against a real iOS simulator through the conductor CLI."
            />
          </>
        }
        shortcuts={
          <>
            <span
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                fontSize: 11,
                color: "var(--text-muted)",
              }}
            >
              <Kbd keys={["⌘", "O"]} /> Open repo
            </span>
            <span
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                fontSize: 11,
                color: "var(--text-muted)",
              }}
            >
              <Kbd keys={["⌘", "N"]} /> New workspace
            </span>
            <span
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                fontSize: 11,
                color: "var(--text-muted)",
              }}
            >
              <Kbd keys={["⌘", "K"]} /> Command palette
            </span>
          </>
        }
      />
    </div>
  ),
};
