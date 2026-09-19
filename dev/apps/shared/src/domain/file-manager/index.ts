export type {
  FileContextMenuState,
  FileDeleteTarget,
  UnsavedPromptAction,
  VaultWorkspaceState,
} from "./workspaceTypes";
export {
  createDefaultWorkspaceState,
  hasUnsavedWorkspaceChanges,
  isPathDirty,
  isPathSessionModified,
  sessionPathKind,
} from "./workspaceTypes";
export type { SessionPathKind } from "./workspaceTypes";
export type { VaultWorkspaceAction } from "./workspaceReducer";
export { vaultWorkspaceReducer, resolveUnsavedPrompt, reorderOpenTabs } from "./workspaceReducer";
export type {
  FileManagerAction,
  FileManagerEntry,
  FileManagerState,
  FileManagerSurface,
} from "./dockReducer";
export { createEmptyFileManagerState, fileManagerReducer } from "./dockReducer";
export {
  applyImportedFilesToWorkspace,
  importBatchIsReadFailure,
  importLogicalFiles,
  type ImportLogicalFile,
  type ImportLogicalResult,
} from "./importLogicalFiles";
export {
  UPRIV_WORKSPACE_FILE_NAME,
  UPRIV_WORKSPACE_PATH,
  WORKSPACE_SNAPSHOT_FORMAT_VERSION,
  isInternalVaultFileName,
  isInternalVaultPath,
  omitInternalVaultNodes,
  parseWorkspaceSnapshot,
  persistWorkspaceSnapshot,
  serializeWorkspaceSnapshot,
  sanitizeWorkspaceSnapshot,
  workspaceSnapshotFromState,
  workspaceStateFromSnapshot,
  snapshotsEqual,
  type WorkspaceSnapshot,
  type WorkspaceSnapshotV1,
} from "./workspaceSnapshot";
