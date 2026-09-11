import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  cacheDir: path.join(root, ".vitest-cache"),
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": path.resolve(root, "src"),
      "@upriv/shared/react": path.resolve(root, "../shared/src/react/index.ts"),
      "@upriv/shared/testing": path.resolve(root, "../shared/src/testing/index.ts"),
      "@upriv/shared": path.resolve(root, "../shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/tests/**/*.test.ts"],
  },
});
