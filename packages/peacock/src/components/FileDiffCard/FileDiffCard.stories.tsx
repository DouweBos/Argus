import type { Meta, StoryObj } from "@storybook/react";
import { parseDiff } from "../../lib/diff";
import { FileDiffCard } from "./FileDiffCard";

const SAMPLE = `diff --git a/packages/peacock/src/components/Button/Button.tsx b/packages/peacock/src/components/Button/Button.tsx
index 1234567..89abcde 100644
--- a/packages/peacock/src/components/Button/Button.tsx
+++ b/packages/peacock/src/components/Button/Button.tsx
@@ -1,6 +1,7 @@
 import type { ButtonHTMLAttributes, ReactNode } from "react";
 import styles from "./Button.module.css";

+export type ButtonTone = "default" | "destructive";
 export type ButtonVariant =
   | "danger"
   | "ghost"
@@ -18,6 +19,7 @@ export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
   variant?: ButtonVariant;
   size?: ButtonSize;
   leading?: ReactNode;
-  trailing?: ReactNode;
+  trailing?: ReactNode | false;
+  tone?: ButtonTone;
 }
`;

const meta: Meta<typeof FileDiffCard> = {
  title: "Components/FileDiffCard",
  component: FileDiffCard,
  parameters: { layout: "padded" },
};

export default meta;

type Story = StoryObj<typeof FileDiffCard>;

export const Modified: Story = {
  args: {
    file: parseDiff(SAMPLE)[0],
  },
};

export const WithHeaderAction: Story = {
  args: {
    file: parseDiff(SAMPLE)[0],
    headerActions: (
      <button
        type="button"
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          background: "none",
          border: "1px solid var(--glass-border)",
          borderRadius: 999,
          padding: "2px 10px",
          cursor: "pointer",
        }}
      >
        View raw
      </button>
    ),
  },
};
