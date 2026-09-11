import { uprivEslint } from "../../js-lint/eslint.js";

export default uprivEslint({
  files: ["**/*.ts"],
  tsconfigRootDir: import.meta.dirname,
  ignores: ["dist", "node_modules", "build"],
});
