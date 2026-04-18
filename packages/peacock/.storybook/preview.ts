import type { Preview } from "@storybook/react";
import "../src/styles/tokens.css";
import "./preview.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "argus",
      values: [
        { name: "argus", value: "#0a0a0f" },
        { name: "secondary", value: "#111118" },
        { name: "tertiary", value: "#1a1a24" },
      ],
    },
    layout: "centered",
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
  },
};

export default preview;
