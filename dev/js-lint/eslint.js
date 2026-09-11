import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import importNewlines from "eslint-plugin-import-newlines";
import tseslint from "typescript-eslint";

const IMPORT_NEWLINES = [
  "warn",
  { items: 7, "max-len": 100, forceSingleLine: true },
];

const MAX_LEN = [
  "warn",
  {
    code: 100,
    ignoreUrls: true,
    ignoreStrings: false,
    ignoreTemplateLiterals: true,
    ignoreRegExpLiterals: true,
  },
];

const UNUSED_VARS = [
  "error",
  { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
];

/**
 * Shared flat config. Each app adds files/ignores and, when needed, React plugins.
 * `eslint-config-prettier` is last so format rules stay off.
 *
 * `tsconfigRootDir` must be the app folder (`import.meta.dirname`). Without it the
 * editor ESLint process sees both desktop and mobile tsconfigs and refuses to parse.
 */
export function uprivEslint({
  files,
  tsconfigRootDir,
  ignores = ["node_modules", "dist"],
  filesIgnores,
  extraPlugins = {},
  extraRules = {},
  extraConfigs = [],
} = {}) {
  if (!tsconfigRootDir) {
    throw new Error(
      "uprivEslint requires tsconfigRootDir — pass import.meta.dirname from the app config",
    );
  }
  return tseslint.config(
    { ignores },
    ...extraConfigs,
    {
      extends: [js.configs.recommended, ...tseslint.configs.recommended],
      files,
      ...(filesIgnores ? { ignores: filesIgnores } : {}),
      languageOptions: {
        ecmaVersion: 2020,
        parserOptions: {
          tsconfigRootDir,
        },
      },
      plugins: {
        "import-newlines": importNewlines,
        ...extraPlugins,
      },
      rules: {
        "import-newlines/enforce": IMPORT_NEWLINES,
        "@typescript-eslint/no-unused-vars": UNUSED_VARS,
        "max-len": MAX_LEN,
        ...extraRules,
      },
    },
    eslintConfigPrettier,
  );
}

/** Type-aware overlay (desktop `vite.config.mjs`). */
export function uprivTypeChecked({ files, project, tsconfigRootDir }) {
  return {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    files,
    languageOptions: {
      ecmaVersion: 2020,
      parserOptions: {
        project,
        tsconfigRootDir,
      },
    },
  };
}

/**
 * Promise hygiene on app `src/` without the full `recommendedTypeChecked` suite
 * (that first wave is mostly `unsafe-*`, not floating promises).
 */
export function uprivPromiseChecked({ files, project, tsconfigRootDir }) {
  return {
    files,
    languageOptions: {
      parserOptions: {
        project,
        tsconfigRootDir,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  };
}
