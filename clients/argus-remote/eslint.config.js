// Standalone Expo app — the repo-root config ignores `clients/**`, so this one
// lints the phone client with Expo's flat config.
const expoConfig = require("eslint-config-expo/flat");
const reactHooks = require("eslint-plugin-react-hooks");

// React Compiler only models Reanimated's shared values as mutable when its
// type definitions are loaded; without this every `sharedValue.value = …` in
// the gesture code reads as a write to an immutable hook result. The compiler
// runs once per file and caches by source, so every compiler-backed rule Expo
// enables has to pass the same environment or whichever runs first wins.
const compilerOptions = {
  environment: { enableCustomTypeDefinitionForReanimated: true },
};

/** Expo's react-hooks rules, re-declared with the Reanimated environment and
 *  their original severity. Adds no rules and changes no severities. */
const compilerRules = Object.fromEntries(
  expoConfig
    .flatMap((block) => Object.entries(block.rules ?? {}))
    .filter(
      ([name]) =>
        name.startsWith("react-hooks/") &&
        reactHooks.rules[name.slice("react-hooks/".length)]?.meta?.schema?.[0]
          ?.additionalProperties === true,
    )
    .map(([name, severity]) => [name, [severity, compilerOptions]]),
);

module.exports = [
  ...expoConfig,
  { rules: compilerRules },
  {
    ignores: ["dist/*", "ios/*", "android/*", ".expo/*"],
  },
];
