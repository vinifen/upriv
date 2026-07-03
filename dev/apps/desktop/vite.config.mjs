import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
const sharedRoot = path.resolve(root, "../shared");
const isElectronBuild = process.env.ELECTRON === "true";

export default defineConfig({
  cacheDir: path.resolve(root, ".vite-cache"),
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
      "@upriv/shared": path.resolve(root, "../shared/src"),
      "@assets": path.resolve(root, "./assets"),
    },
  },
  clearScreen: false,
  envPrefix: ["VITE_"],
  server: {
    fs: {
      allow: [root, sharedRoot],
    },
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "chrome120",
    minify: "esbuild",
    emptyOutDir: true,
    outDir: isElectronBuild ? "renderer-out" : "dist",
  },
  base: isElectronBuild ? "./" : "/",
});
