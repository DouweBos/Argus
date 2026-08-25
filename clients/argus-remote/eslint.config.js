// Standalone Expo app — the repo-root config ignores `clients/**`, so this one
// lints the phone client with Expo's flat config.
const expoConfig = require("eslint-config-expo/flat");

module.exports = [
  ...expoConfig,
  {
    ignores: ["dist/*", "ios/*", "android/*", ".expo/*"],
  },
];
