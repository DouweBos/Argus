import js from "@eslint/js";
import perfectionist from "eslint-plugin-perfectionist";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist", "dist-electron"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      perfectionist,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              importNames: ["useImperativeHandle"],
              message:
                "useImperativeHandle is banned. Use props/callbacks instead.",
            },
          ],
        },
      ],
      "perfectionist/sort-union-types": ["error", { type: "alphabetical" }],
      "perfectionist/sort-interfaces": ["error", { type: "alphabetical" }],
      "perfectionist/sort-object-types": ["error", { type: "alphabetical" }],
    },
  },
  prettier,
);
