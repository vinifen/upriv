/** Public API — only exports consumed outside `vaults/file-manager/`. */
export { FileManagerProvider, useFileManager } from "./FileManagerContext";
export { FileManagerLayer } from "./FileManagerLayer";
export { hasUnsavedWorkspaceChanges } from "./lib/fileManagerWorkspaceTypes";
