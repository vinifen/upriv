import reactHooks from "eslint-plugin-react-hooks";
import { uprivEslint, uprivPromiseChecked } from "../../js-lint/eslint.js";

export default uprivEslint({
  files: ["**/*.ts"],
  tsconfigRootDir: import.meta.dirname,
  extraPlugins: { "react-hooks": reactHooks },
  extraRules: { ...reactHooks.configs.recommended.rules },
  extraConfigs: [
    uprivPromiseChecked({
      files: ["src/**/*.ts"],
      project: ["./tsconfig.json"],
      tsconfigRootDir: import.meta.dirname,
    }),
  ],
});
