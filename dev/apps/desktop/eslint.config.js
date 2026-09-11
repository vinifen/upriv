import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { uprivEslint, uprivPromiseChecked, uprivTypeChecked } from "../../js-lint/eslint.js";

export default uprivEslint({
  files: ["**/*.{ts,tsx}"],
  tsconfigRootDir: import.meta.dirname,
  ignores: ["dist", "renderer-out", ".vite-cache", "node_modules"],
  filesIgnores: ["vite.config.mjs"],
  extraConfigs: [
    uprivTypeChecked({
      files: ["vite.config.mjs"],
      project: ["./tsconfig.node.json"],
      tsconfigRootDir: import.meta.dirname,
    }),
    uprivPromiseChecked({
      files: ["src/**/*.{ts,tsx}"],
      project: ["./tsconfig.json"],
      tsconfigRootDir: import.meta.dirname,
    }),
  ],
  extraPlugins: {
    "react-hooks": reactHooks,
    "react-refresh": reactRefresh,
  },
  extraRules: {
    ...reactHooks.configs.recommended.rules,
    "react-refresh/only-export-components": "off",
  },
});
