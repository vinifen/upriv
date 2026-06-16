import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
      "@upriv/shared": path.resolve(root, "../shared/src"),
      "@assets": path.resolve(root, "./assets"),
    },
  },
  clearScreen: false,
  envPrefix: [
    "VITE_",
    "TAURI_ENV_*",
    "TAURI_PLATFORM",
    "TAURI_ARCH",
    "TAURI_FAMILY",
    "TAURI_PLATFORM_VERSION",
    "TAURI_PLATFORM_TYPE",
    "TAURI_DEBUG",
  ],
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["../../src-tauri/**"],
    },
  },
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG === "true" ? false : "esbuild",
    sourcemap: process.env.TAURI_ENV_DEBUG === "true",
    // Tauri loads the WebView from the filesystem — relative asset URLs.
    emptyOutDir: true,
  },
  base: process.env.TAURI_ENV_PLATFORM ? "./" : "/",
});
