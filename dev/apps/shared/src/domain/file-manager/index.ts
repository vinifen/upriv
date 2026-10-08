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
  sessionPathKind,
} from "./workspaceTypes";
export type { SessionPathKind } from "./workspaceTypes";
export type { VaultWorkspaceAction } from "./workspaceReducer";
export { vaultWorkspaceReducer, resolveUnsavedPrompt, reorderOpenTabs } from "./workspaceReducer";
export {
  MAX_DIRTY_DRAFT_SAVE_PASSES,
  saveDirtyVaultDrafts,
  withSavedDraftDiskContents,
} from "./saveDirtyDrafts";
export {
  unsavedPromptBodyKey,
  unsavedPromptConfirmsAllFiles,
  unsavedPromptIsImport,
} from "./unsavedPrompt";
export {
  fileTabMenuAction,
  fileTabMenuItems,
  type FileTabMenuItem,
  type FileTabMenuItemId,
} from "./tabMenu";
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
  vaultCloseBlockingPrompt,
  fileManagerReducer,
} from "./dockReducer";
export {
  applyImportedFilesToWorkspace,
  importBatchIsReadFailure,
  importBatchIsWriteFailure,
  importLogicalFiles,
  type ImportLogicalFile,
  type ImportLogicalResult,
} from "./importLogicalFiles";
export { currentImportFileSlots, importFileSlots } from "./importSlots";
export { yieldToPaint } from "./yieldToPaint";
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
