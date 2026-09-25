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
  FileManagerDismissIntent,
  FileManagerEntry,
  FileManagerState,
  FileManagerSurface,
} from "./dockReducer";
export {
  createEmptyFileManagerState,
  fileManagerBlockingPrompt,
  fileManagerDismissIntent,
  fileManagerReducer,
} from "./dockReducer";
export {
  applyImportedFilesToWorkspace,
  importBatchIsReadFailure,
  importBatchIsWriteFailure,
  importBatchNeedsRetry,
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
  serializedLayoutSnapshot,
  serializeWorkspaceSnapshot,
  sanitizeWorkspaceSnapshot,
  workspaceSnapshotFromState,
  workspaceStateFromSnapshot,
  snapshotsEqual,
  isDefaultWorkspaceSnapshot,
  shouldHydratePersistedWorkspace,
  type WorkspaceSnapshot,
  type WorkspaceSnapshotV1,
} from "./workspaceSnapshot";
