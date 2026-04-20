import type { Meta, StoryObj } from "@storybook/react";
import { SparkleIcon } from "../../icons/HomeIcons";
import { FolderIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { Kbd } from "../Kbd/Kbd";
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
              <Kbd keys={["⌘", "N"]} /> New session
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
