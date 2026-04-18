import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Chip } from "../Chip/Chip";
import { ChatInput } from "./ChatInput";

const meta: Meta<typeof ChatInput> = {
  title: "Composites/ChatInput",
  component: ChatInput,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof ChatInput>;

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState(
      "Refactor the workspace card to use the new…",
    );

    return (
      <div style={{ width: 480 }}>
        <ChatInput
          value={value}
          onChange={setValue}
          actions={
            <>
              <Chip mono>sonnet-4.5</Chip>
              <Chip muted>Plan mode</Chip>
            </>
          }
        />
      </div>
    );
  },
};
