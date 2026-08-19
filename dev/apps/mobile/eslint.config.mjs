import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import importNewlines from "eslint-plugin-import-newlines";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "android",
      "ios",
      ".expo",
      "node_modules",
      "modules/upriv-core/android",
      "modules/upriv-core/ios",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
    },
    plugins: {
      "import-newlines": importNewlines,
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "import-newlines/enforce": ["warn", { items: 7, "max-len": 100, forceSingleLine: true }],
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
      // Expo / RN entry and navigation often use default exports.
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  eslintConfigPrettier,
);
