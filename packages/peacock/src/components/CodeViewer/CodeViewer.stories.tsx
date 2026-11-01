import type { Meta, StoryObj } from "@storybook/react";
import { CodeViewer } from "./CodeViewer";

const meta: Meta<typeof CodeViewer> = {
  title: "Components/CodeViewer",
  component: CodeViewer,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof CodeViewer>;

const TS = `import { useEffect, useState } from "react";

/** Polls the computer while the tab is visible. */
export function useLiveRefresh(refresh: () => Promise<void>, ms = 5000) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      refresh().catch(() => setFailed(true));
    }, ms);

    return () => clearInterval(id);
  }, [refresh, ms]);

  return failed ? "offline" : \`every \${ms / 1000}s\`;
}
`;

const SWIFT = `import SwiftUI

struct FileView: View {
  let path: String
  @State private var lines = 0

  var body: some View {
    Text("\\(lines) lines") // live
      .font(.caption)
  }
}
`;

export const TypeScript: Story = { args: { code: TS, language: "typescript" } };

export const Swift: Story = { args: { code: SWIFT, language: "swift" } };

export const FocusedLine: Story = {
  args: { code: TS, language: "typescript", focusLine: 9 },
};

export const PlainText: Story = {
  args: { code: "MIT License\n\nCopyright (c) 2026\n", language: null },
};

export const Wrapped: Story = {
  args: {
    code: `const message = "${"a long line that keeps going ".repeat(12)}";\n`,
    language: "javascript",
    wrap: true,
  },
};
