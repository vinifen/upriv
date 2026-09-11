import reactHooks from "eslint-plugin-react-hooks";
import { uprivEslint, uprivPromiseChecked } from "../../js-lint/eslint.js";

export default uprivEslint({
  files: ["**/*.{ts,tsx}"],
  tsconfigRootDir: import.meta.dirname,
  ignores: [
    "dist",
    "android",
    "ios",
    ".expo",
    "node_modules",
    "modules/upriv-core/android",
    "modules/upriv-core/ios",
  ],
  extraPlugins: {
    "react-hooks": reactHooks,
  },
  extraRules: {
    ...reactHooks.configs.recommended.rules,
    "@typescript-eslint/no-require-imports": "off",
  },
  extraConfigs: [
    uprivPromiseChecked({
      files: ["src/**/*.{ts,tsx}"],
      project: ["./tsconfig.json"],
      tsconfigRootDir: import.meta.dirname,
    }),
  ],
});
