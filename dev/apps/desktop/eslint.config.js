import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import importNewlines from "eslint-plugin-import-newlines";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    files: ["vite.config.ts"],
    languageOptions: {
      ecmaVersion: 2020,
      parserOptions: {
        project: ["./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    ignores: ["vite.config.ts"],
    languageOptions: {
      ecmaVersion: 2020,
    },
    plugins: {
      "import-newlines": importNewlines,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Provider + hook co-location (contexts, i18n) is intentional in this codebase.
      "react-refresh/only-export-components": "off",
      // Break import { a, b, c, … } when more than `items` specifiers (sync max-len with rule below).
      "import-newlines/enforce": ["warn", { items: 4, "max-len": 100, forceSingleLine: true }],
      "max-len": [
        "warn",
        {
          code: 100,
          ignoreUrls: true,
          ignoreStrings: false,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true,
        },
      ],
    },
  },
  eslintConfigPrettier,
);
