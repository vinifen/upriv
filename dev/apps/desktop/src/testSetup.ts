import { File } from "node:buffer";

if (typeof globalThis.File === "undefined") {
  (globalThis as unknown as { File: typeof File }).File = File;
}
