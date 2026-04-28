import type { Preview } from "@storybook/react";
import "../src/styles/fonts.css";
import "../src/styles/tokens.css";
import "./preview.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "argus",
      values: [
        { name: "argus", value: "#15151c" },
        { name: "secondary", value: "#1c1c25" },
        { name: "tertiary", value: "#252531" },
      ],
    },
    layout: "centered",
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
  },
};

export default preview;
