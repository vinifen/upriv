/** Public API — only exports consumed outside `vaults/file-manager/`. */
export { FileManagerProvider, useFileManager } from "./FileManagerContext";
export { FileManagerLayer } from "./FileManagerLayer";
export { VaultFileManagerIndicator } from "./row/VaultFileManagerIndicator";
export {
  fileManagerBlockingPrompt,
  fileManagerDismissIntent,
  hasUnsavedWorkspaceChanges,
} from "@upriv/shared";
