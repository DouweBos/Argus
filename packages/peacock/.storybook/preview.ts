import { withThemeByDataAttribute } from "@storybook/addon-themes";
import type { Preview } from "@storybook/react";
import "../src/styles/fonts.css";
import "../src/styles/tokens.css";
import "../src/styles/reset.css";
import "./preview.css";

const preview: Preview = {
  // Every story renders in both themes — the toolbar switch flips
  // `data-theme` on <html>, which is exactly what the app does.
  decorators: [
    withThemeByDataAttribute({
      themes: { dark: "dark", light: "light" },
      defaultTheme: "dark",
      attributeName: "data-theme",
    }),
  ],
  parameters: {
    backgrounds: { disable: true },
    layout: "centered",
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
  },
};

export default preview;
