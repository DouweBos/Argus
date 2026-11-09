import js from "@eslint/js";
import confusingBrowserGlobals from "confusing-browser-globals";
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";
import vitest from "@vitest/eslint-plugin";
import globals from "globals";
import prettier from "eslint-config-prettier";

const baseJSRules = {
  "block-scoped-var": "error",
  "consistent-this": ["error", "self"],
  "dot-notation": "error",
  eqeqeq: ["error", "smart"],
  "no-array-constructor": "error",
  "no-caller": "error",
  "no-console": "error",
  "no-debugger": "error",
  "no-eval": "error",
  "no-extend-native": "error",
  "no-extra-bind": "error",
  "no-floating-decimal": "error",
  "no-implicit-coercion": ["error", { boolean: false }],
  "no-implied-eval": "error",
  "no-labels": "error",
  "no-lone-blocks": "error",
  "no-lonely-if": "error",
  "no-loop-func": "error",
  "no-multi-str": "error",
  "no-nested-ternary": "warn",
  "no-new-func": "error",
  "no-new-object": "error",
  "no-new-wrappers": "error",
  "no-octal-escape": "error",
  "no-proto": "error",
  "no-restricted-globals": ["error", ...confusingBrowserGlobals],
  "no-return-assign": "error",
  "no-script-url": "error",
  "no-self-compare": "error",
  "no-sequences": "error",
  "no-shadow": "off",
  "no-throw-literal": "off",
  "no-undef-init": "error",
  "no-unneeded-ternary": "error",
  "no-unused-vars": "off",
  "no-use-before-define": "off",
  "no-useless-call": "error",
  "no-useless-concat": "error",
  "no-void": "error",
  "object-shorthand": "error",
  "one-var": ["error", "never"],
  "prefer-const": "error",
  radix: "error",
  "sort-imports": "off",
  "wrap-iife": ["error", "any"],
  yoda: "error",
};

const baseImportRules = {
  "import/first": "error",
  "import/newline-after-import": "error",
  "import/no-anonymous-default-export": [
    "error",
    {
      allowAnonymousClass: false,
      allowAnonymousFunction: false,
      allowArray: false,
      allowArrowFunction: false,
      allowLiteral: false,
      allowObject: false,
    },
  ],
  "import/no-extraneous-dependencies": [
    "error",
    {
      devDependencies: [
        "**/*.test.{ts,tsx}",
        "**/*.config.{js,mjs,cjs,ts,mts}",
        "build-host.mjs",
        "scripts/**",
        "vitest.setup.ts",
      ],
    },
  ],
  "import/no-named-as-default": "error",
  "import/no-relative-packages": "error",
  "import/order": [
    "error",
    {
      alphabetize: { order: "asc" },
      groups: [
        ["builtin", "external", "type"],
        "internal",
        "parent",
        "sibling",
        "index",
      ],
      "newlines-between": "never",
    },
  ],
};

const baseTypeScriptRules = {
  "@typescript-eslint/array-type": "error",
  "@typescript-eslint/ban-ts-comment": "off",
  "@typescript-eslint/class-literal-property-style": "error",
  "@typescript-eslint/consistent-generic-constructors": "error",
  "@typescript-eslint/consistent-type-assertions": "error",
  "@typescript-eslint/consistent-type-definitions": "error",
  "@typescript-eslint/consistent-type-imports": [
    "error",
    { fixStyle: "inline-type-imports" },
  ],
  "@typescript-eslint/explicit-member-accessibility": "off",
  "@typescript-eslint/method-signature-style": "error",
  "@typescript-eslint/no-confusing-non-null-assertion": "error",
  "@typescript-eslint/no-duplicate-enum-values": "error",
  "@typescript-eslint/no-dynamic-delete": "warn",
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/no-extraneous-class": "error",
  "@typescript-eslint/no-import-type-side-effects": "error",
  "@typescript-eslint/no-invalid-void-type": "error",
  "@typescript-eslint/no-loop-func": "error",
  "@typescript-eslint/no-non-null-asserted-nullish-coalescing": "error",
  "@typescript-eslint/no-shadow": "error",
  "@typescript-eslint/no-unsafe-declaration-merging": "error",
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      args: "after-used",
      argsIgnorePattern: "^_",
      ignoreRestSiblings: true,
    },
  ],
  "@typescript-eslint/no-use-before-define": [
    "error",
    { functions: false, variables: false },
  ],
  "@typescript-eslint/prefer-function-type": "error",
  "@typescript-eslint/prefer-literal-enum-member": "error",
  "@typescript-eslint/prefer-ts-expect-error": "error",
  "@typescript-eslint/sort-type-constituents": "error",
  "@typescript-eslint/unified-signatures": "error",
  "@typescript-eslint/explicit-function-return-type": "off",
};

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dist-host",
      // The removed Electron app's build output, left in older checkouts.
      "dist-electron",
      // Release output and vendored gems — never ours to lint.
      "release",
      "release-server",
      "vendor",
      // The Mac app run command's derived data.
      ".build",
      "**/storybook-static/**",
      "packages/peacock/vite.config.ts",
      "packages/peacock/.storybook/**",
      ".claude/worktrees/**",
      // The native apps and the web client, checked by their own builds.
      "clients/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs,cjs,js}"],
    plugins: { import: importPlugin },
    settings: {
      "import/resolver": {
        typescript: {
          noWarnOnMultipleProjects: true,
          project: [
            "./tsconfig.node.json",
            "./packages/host/tsconfig.json",
            "./packages/peacock/tsconfig.json",
            "./packages/remote-protocol/tsconfig.json",
            "./packages/remote-client/tsconfig.json",
            "./packages/client-core/tsconfig.json",
          ],
        },
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: [
          "./tsconfig.node.json",
          "./packages/host/tsconfig.json",
          "./packages/peacock/tsconfig.json",
          "./packages/remote-protocol/tsconfig.json",
          "./packages/remote-client/tsconfig.json",
          "./packages/client-core/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...baseJSRules,
      ...baseImportRules,
      ...baseTypeScriptRules,
    },
  },
  {
    files: ["packages/host/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "no-restricted-globals": "off",
    },
  },
  {
    // `@argus/host` is plain Node — the desktop shell is reached through
    // `HostPlatform`, never by importing electron.
    files: ["packages/host/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["electron", "electron/*"],
              message:
                "@argus/host must stay Electron-free. Add the capability to HostPlatform instead.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.config.{js,mjs,cjs,ts,mts}", "build-host.mjs"],
    rules: {
      "import/no-anonymous-default-export": "off",
    },
  },
  {
    files: ["*.cjs"],
    languageOptions: {
      globals: globals.node,
      sourceType: "commonjs",
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["scripts/**/*.{ts,mts,js,mjs,cjs}"],
    languageOptions: {
      globals: globals.node,
      sourceType: "commonjs",
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["build-host.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.{test,spec}.{ts,tsx}"],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      "vitest/consistent-test-it": "error",
      "vitest/no-alias-methods": "error",
      "vitest/no-conditional-expect": "error",
      "vitest/no-done-callback": "error",
      "vitest/no-duplicate-hooks": "error",
      "vitest/no-focused-tests": "error",
      "vitest/no-standalone-expect": "error",
      "vitest/no-test-return-statement": "error",
      "vitest/prefer-comparison-matcher": "error",
      "vitest/prefer-each": "error",
      "vitest/prefer-expect-resolves": "error",
      "vitest/prefer-hooks-in-order": "error",
      "vitest/prefer-hooks-on-top": "error",
      "vitest/prefer-lowercase-title": "error",
      "vitest/prefer-mock-promise-shorthand": "error",
      "vitest/prefer-spy-on": "error",
      "vitest/prefer-to-be": "error",
      "vitest/prefer-to-contain": "error",
      "vitest/prefer-to-have-length": "error",
      "vitest/require-hook": "error",
      "vitest/require-top-level-describe": "error",
      "import/no-extraneous-dependencies": "off",
    },
  },
  prettier,
  {
    files: ["**/*.{ts,tsx,mjs,cjs,js}"],
    rules: {
      // eslint-config-prettier turns `curly` off; re-enable so single-statement
      // branches require braces (no `if (cond) return;` without `{ }`).
      curly: ["error", "all"],
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: "return" },
      ],
    },
  },
);
