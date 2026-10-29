import { File } from "node:buffer";

if (typeof globalThis.File === "undefined") {
  (globalThis as unknown as { File: typeof File }).File = File;
}

if (typeof (globalThis as Record<string, unknown>).__UPRIV_APP_VERSION__ === "undefined") {
  (globalThis as Record<string, unknown>).__UPRIV_APP_VERSION__ = "0.2.2-beta";
}
