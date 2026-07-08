import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
const sharedRoot = path.resolve(root, "../shared");
const devRoot = path.resolve(root, "../..");
const isElectronBuild = process.env.ELECTRON === "true";
const appVersion = fs.readFileSync(path.join(devRoot, "VERSION"), "utf8").trim();

export default defineConfig({
  cacheDir: path.resolve(root, ".vite-cache"),
  plugins: [react()],
  define: {
    __UPRIV_APP_VERSION__: JSON.stringify(appVersion),
  },
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
