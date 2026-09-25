/** Public API — only exports consumed outside `vaults/file-manager/`. */
export { FileManagerProvider, useFileManager } from "./FileManagerContext";
export { FileManagerLayer } from "./FileManagerLayer";
export {
  fileManagerBlockingPrompt,
  fileManagerDismissIntent,
  hasUnsavedWorkspaceChanges,
} from "@upriv/shared";
